import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {validateRequest,SCHEMA_VERSION} from './contract.mjs';
import {DIMENSIONS} from './rubrics.mjs';
import {scoreHeuristic} from './scorer.mjs';
import {scoreWithOpenAI,resolveTimeoutMs} from './provider.mjs';
import {scoreWithBailian,DEFAULT_BAILIAN_MODEL,DEFAULT_BAILIAN_TRANSPORT,BAILIAN_TRANSPORTS,resolveBailianTransport} from './bailian-provider.mjs';

export const MAX_BODY_BYTES = 128*1024;
export const ALLOWED_ORIGINS = new Set(['http://localhost:5173','http://127.0.0.1:5173']);
export const PROVIDERS = new Set(['openai','bailian']);
const MODULE_VERSION = '0.6.0';

// Client-safe messages only: never forward provider internals, stacks or request data.
const ERROR_TABLE = {
  EMPTY_TRANSCRIPT:{status:422,message:'未提供转写文本，请重新录音或编辑文本后再试。',retryable:false},
  API_KEY_MISSING:{status:503,message:'服务器尚未配置 AI 评分所需的 API Key，请联系管理员或改用离线模式。',retryable:false},
  FETCH_UNAVAILABLE:{status:502,message:'服务器运行环境不支持调用模型服务，请使用 Node.js 18+。',retryable:false},
  PROVIDER_HTTP_ERROR:{status:502,message:'模型服务暂时不可用，请稍后重试或使用离线模式。',retryable:true},
  PROVIDER_NETWORK_ERROR:{status:502,message:'模型服务连接失败，请稍后重试或使用离线模式。',retryable:true},
  PROVIDER_INCOMPLETE:{status:502,message:'模型输出不完整，本次不生成评分，请重试。',retryable:true},
  PROVIDER_REFUSAL:{status:502,message:'模型拒绝处理本次请求，本次不生成评分。',retryable:false},
  INVALID_MODEL_OUTPUT:{status:502,message:'模型返回结果未通过评分校验，本次不生成评分，请重试。',retryable:true},
  PROVIDER_TIMEOUT:{status:504,message:'模型响应超时，请稍后重试或使用离线模式。',retryable:true},
  PROVIDER_CONFIG_ERROR:{status:503,message:'百炼服务地址或接口不可用：默认地址 https://dashscope.aliyuncs.com/compatible-mode/v1 已实测可用；若自行填写 BAILIAN_BASE_URL，请把 {WorkspaceId} 换成控制台里的真实业务空间 ID，并确认接口为 responses 或 chat/completions。',retryable:false},
  PROVIDER_AUTH_ERROR:{status:503,message:'百炼鉴权或业务空间调用权限校验未通过：请确认 API Key 有效、与地域匹配，且该业务空间已开通所用模型。',retryable:false},
  PROVIDER_MODEL_UNAVAILABLE:{status:502,message:'所用模型在当前业务空间或地域不可用：请核对模型 ID 与业务空间权限，不要自行切换地域或开通付费服务。',retryable:false}
};

/** 供应商选择只影响传输层；评分算法与 Schema 1.4.0 信封两种通路完全一致。 */
export function resolveProvider(value){
  const name=String(value||'openai').trim().toLowerCase();
  if(!PROVIDERS.has(name)) throw new RangeError(`Unsupported SCORING_PROVIDER: ${value}`);
  return name;
}

/* INVALID_MODEL_OUTPUT 对外只能说「没过校验」，而具体是哪一条校验原先在 HTTP 边界就被丢掉了，
   本机出一次故障就只能靠猜。下面把校验异常映射成固定规则名（最多附一个维度枚举名）；
   匹配不到就是 UNSPECIFIED，任何情况下都不会把模型原文、转写内容或密钥带进这条诊断。 */
const VALIDATION_RULES = [
  [/有效的结构化反馈/, 'MODEL_TEXT_NOT_JSON'],
  [/不是可解析的 JSON/, 'PROVIDER_BODY_NOT_JSON'],
  [/AI response must be a JSON object/, 'NOT_A_JSON_OBJECT'],
  [/Response mode must be ai/, 'MODE_NOT_AI'],
  [/Response stage mismatch/, 'STAGE_MISMATCH'],
  [/Missing official rubric basis/, 'MISSING_RUBRIC_BASIS'],
  [/Must not report an official level/, 'OFFICIAL_LEVEL_PREDICTED'],
  [/Missing scores\/PEEL/, 'MISSING_SCORES_OR_PEEL'],
  [/Invalid score:/, 'INVALID_DIMENSION_SCORE'],
  [/Missing array:/, 'MISSING_REQUIRED_ARRAY'],
  [/^Invalid (?:strengths|weaknesses|suggestions|nextPractice|unassessed)$/, 'INVALID_ARRAY_ITEM_TYPE'],
  [/Invalid dimension feedback item/, 'INVALID_DIMENSION_FEEDBACK_ITEM'],
  [/Dimension feedback quote must be verbatim/, 'NON_VERBATIM_FEEDBACK_QUOTE'],
  [/Invented PEEL quote:/, 'INVENTED_PEEL_QUOTE'],
  [/Invalid PEEL status:/, 'INVALID_PEEL_STATUS'],
  [/Invalid PEEL detail:/, 'INVALID_PEEL_DETAIL'],
  [/Evidence must quote transcript verbatim/, 'NON_VERBATIM_EVIDENCE'],
  [/Improved expressions must quote transcript verbatim/, 'NON_VERBATIM_IMPROVED_EXPRESSION'],
  [/must not return an aggregate practice score/, 'MODEL_RETURNED_AGGREGATE_SCORE'],
  [/Missing dimension rationale:/, 'MISSING_DIMENSION_RATIONALE'],
  [/No assessable dimension score/, 'NO_ASSESSABLE_DIMENSION_SCORE'],
  [/Inactive dimension must be null:/, 'INACTIVE_DIMENSION_SCORED']
];
export function validationReasonOf(message){
  const text=String(message||'');
  for(const [pattern,rule] of VALIDATION_RULES){
    if(!pattern.test(text)) continue;
    const dimension=DIMENSIONS.find(key=>text.includes(key));
    return dimension?`${rule}:${dimension}`:rule;
  }
  return 'UNSPECIFIED';
}

function corsHeaders(req){
  const origin=req.headers.origin;
  if(!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Max-Age':'600',
    'Vary':'Origin'
  };
}
function sendJson(req,res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders(req)});
  res.end(body);
}
function sendError(req,res,status,code,message,retryable=false){
  sendJson(req,res,status,{success:false,error:{code,message,retryable}});
}
function sendScoringError(req,res,code){
  const entry=ERROR_TABLE[code]||{status:500,message:'评分服务内部错误，请稍后重试。',retryable:false};
  sendError(req,res,entry.status,ERROR_TABLE[code]?code:'INTERNAL_ERROR',entry.message,entry.retryable);
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    const declared=Number(req.headers['content-length']);
    if(Number.isFinite(declared) && declared>MAX_BODY_BYTES){reject(Object.assign(new Error('too large'),{httpCode:'PAYLOAD_TOO_LARGE'}));req.resume();return;}
    const chunks=[];let total=0;let failed=false;
    req.on('data',chunk=>{
      if(failed)return;
      total+=chunk.length;
      if(total>MAX_BODY_BYTES){failed=true;reject(Object.assign(new Error('too large'),{httpCode:'PAYLOAD_TOO_LARGE'}));req.resume();return;}
      chunks.push(chunk);
    });
    req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks).toString('utf8'));});
    req.on('error',err=>{if(!failed){failed=true;reject(err);}});
  });
}

export function createScoringServer({mode='heuristic',provider=process.env.SCORING_PROVIDER||'openai',apiKey=provider==='bailian'?(process.env.BAILIAN_API_KEY||process.env.DASHSCOPE_API_KEY):process.env.OPENAI_API_KEY,bailianApiKey=process.env.BAILIAN_API_KEY||process.env.DASHSCOPE_API_KEY||apiKey,model=process.env.OPENAI_MODEL,bailianModel=process.env.BAILIAN_MODEL||DEFAULT_BAILIAN_MODEL,bailianBaseUrl=process.env.BAILIAN_BASE_URL,bailianTransport=process.env.BAILIAN_SCORING_TRANSPORT||DEFAULT_BAILIAN_TRANSPORT,bailianReasoningEffort=process.env.BAILIAN_SCORING_REASONING_EFFORT||'',bailianEnableThinking=/^(1|true|yes)$/i.test(process.env.BAILIAN_ENABLE_THINKING||''),fetchImpl=globalThis.fetch,timeoutMs}={}){
  if(mode!=='heuristic' && mode!=='ai') throw new RangeError(`Unsupported SCORING_MODE: ${mode}`);
  const activeProvider=resolveProvider(provider);
  // 接口名与供应商一样只影响传输层；非法值在构造阶段抛出，避免运行期静默回退。
  const activeTransport=resolveBailianTransport(bailianTransport);
  // 百炼绝不复用 OPENAI_API_KEY：apiKey 的默认值已按供应商分流，显式传入 bailianApiKey:'' 时不回退。
  const activeKey=activeProvider==='bailian'?bailianApiKey:apiKey;
  const activeModel=activeProvider==='bailian'?bailianModel:model;
  // 超时统一走 resolveTimeoutMs：显式值 > SCORING_TIMEOUT_MS > 供应商默认（bailian 120000 / openai 45000），钳制 1000–120000。
  const activeTimeoutMs=resolveTimeoutMs(activeProvider,timeoutMs);
  return http.createServer(async (req,res)=>{
    try{
      const path=(req.url||'').split('?')[0];
      if(req.method==='OPTIONS'){
        if(corsHeaders(req)['Access-Control-Allow-Origin']){res.writeHead(204,corsHeaders(req));res.end();}
        else sendError(req,res,403,'CORS_FORBIDDEN','该来源不被允许跨域访问。');
        return;
      }
      if(path==='/health' && req.method==='GET'){
        // heuristic 模式不涉及供应商，保持 B 钉住的 5 键形状；ai 模式才追加供应商/接口/超时/模型诊断字段。
        const data={status:'ok',mode,schemaVersion:SCHEMA_VERSION,moduleVersion:MODULE_VERSION,aiKeyConfigured:Boolean(activeKey)};
        if(mode==='ai') Object.assign(data,{provider:activeProvider,transport:activeProvider==='bailian'?activeTransport:null,timeoutMs:activeTimeoutMs,model:activeModel});
        sendJson(req,res,200,{success:true,data,meta:{questionId:null,demoOnly:false}});
        return;
      }
      if(path==='/api/evaluate' && req.method==='POST'){
        let raw;
        try{raw=await readBody(req);}
        catch(err){
          if(err.httpCode==='PAYLOAD_TOO_LARGE')return sendError(req,res,413,'PAYLOAD_TOO_LARGE','请求体超过 128 KB 限制，请精简转写文本后重试。');
          return sendError(req,res,400,'REQUEST_READ_ERROR','请求读取失败，请重试。');
        }
        let request;
        try{request=JSON.parse(raw);}
        catch{return sendError(req,res,400,'INVALID_JSON','请求体不是合法 JSON。');}
        try{validateRequest(request);}
        catch(err){return sendError(req,res,422,'INVALID_FIELD',err instanceof TypeError||err instanceof RangeError?err.message:'请求字段无效。');}
        const questionId=typeof request.questionId==='string'?request.questionId:null;
        // Error priority: empty transcript (422) outranks missing API key (503); never call the model for empty input.
        if(!request.transcript.trim()) return sendScoringError(req,res,'EMPTY_TRANSCRIPT');
        if(mode==='ai' && !activeKey) return sendScoringError(req,res,'API_KEY_MISSING');
        // 百炼默认 responses 通路走成员 B 实测通过的 provider.mjs（嵌套 json_schema、16384 token、effort=low）；
        // chat 是保留的备用通路，只有显式 BAILIAN_SCORING_TRANSPORT=chat 才用到，从未真实验证。
        if(mode==='ai'&&activeProvider==='bailian'&&/\{WorkspaceId\}/.test(String(bailianBaseUrl||process.env.BAILIAN_BASE_URL||'')))
          return sendScoringError(req,res,'PROVIDER_CONFIG_ERROR');
        const result=mode==='ai'
          ? (activeProvider==='bailian'
              ? (activeTransport==='chat'
                  ? await scoreWithBailian(request,{apiKey:activeKey,model:activeModel,baseUrl:bailianBaseUrl,transport:'chat',reasoningEffort:bailianReasoningEffort,fetchImpl,timeoutMs:activeTimeoutMs,enableThinking:bailianEnableThinking})
                  : await scoreWithOpenAI(request,{provider:'bailian',apiKey:activeKey,model:activeModel,baseUrl:bailianBaseUrl,fetchImpl,timeoutMs:activeTimeoutMs}))
              : await scoreWithOpenAI(request,{provider:'openai',apiKey:activeKey,model:activeModel,fetchImpl,timeoutMs:activeTimeoutMs}))
          : scoreHeuristic(request);
        if(Array.isArray(result.errors) && result.errors.length>0){
          const {code,message}=result.errors[0];
          // 诊断只打固定规则名：转写原文、模型原文与密钥都不进日志，也不进对外响应。
          if(code==='INVALID_MODEL_OUTPUT') console.log(`[scoring] INVALID_MODEL_OUTPUT rule=${validationReasonOf(message)}`);
          return sendScoringError(req,res,code);
        }
        sendJson(req,res,200,{success:true,data:result,meta:{questionId,demoOnly:false}});
        return;
      }
      if(path==='/health'||path==='/api/evaluate') return sendError(req,res,405,'METHOD_NOT_ALLOWED','该路径不支持此 HTTP 方法。');
      sendError(req,res,404,'NOT_FOUND','接口不存在。');
    }catch{
      if(!res.headersSent) sendError(req,res,500,'INTERNAL_ERROR','评分服务内部错误，请稍后重试。');
      else res.end();
    }
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=process.env.SCORING_MODE||'heuristic';
  const provider=process.env.SCORING_PROVIDER||'openai';
  const port=Number(process.env.PORT||3001);
  if(mode!=='heuristic' && mode!=='ai'){
    console.error(`SCORING_MODE 仅支持 heuristic 或 ai，收到：${mode}`);
    process.exit(1);
  }
  let activeProvider;
  try{activeProvider=resolveProvider(provider);}
  catch{
    console.error(`SCORING_PROVIDER 仅支持 openai 或 bailian，收到：${provider}`);
    process.exit(1);
  }
  // 只报告「有没有配」，绝不打印任何密钥内容；缺密钥也照常启动，便于无 Key 演示。
  let activeTransport;
  try{activeTransport=resolveBailianTransport(process.env.BAILIAN_SCORING_TRANSPORT);}
  catch{
    console.error(`BAILIAN_SCORING_TRANSPORT 仅支持 ${[...BAILIAN_TRANSPORTS].join(' 或 ')}，收到：${process.env.BAILIAN_SCORING_TRANSPORT}`);
    process.exit(1);
  }
  const timeoutMs=resolveTimeoutMs(activeProvider);
  if(mode==='ai'){
    const keyName=activeProvider==='bailian'?'BAILIAN_API_KEY 或 DASHSCOPE_API_KEY':'OPENAI_API_KEY';
    const configured=activeProvider==='bailian'
      ? Boolean(process.env.BAILIAN_API_KEY||process.env.DASHSCOPE_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY);
    if(!configured) console.warn(`警告：SCORING_MODE=ai 但未配置 ${keyName}，/api/evaluate 将返回 503。`);
    if(activeProvider==='bailian'&&/\{WorkspaceId\}/.test(process.env.BAILIAN_BASE_URL||''))
      console.warn('警告：BAILIAN_BASE_URL 里仍是 {WorkspaceId} 占位符。北京地域已实测 https://dashscope.aliyuncs.com/compatible-mode/v1 可用，或替换为控制台里的真实业务空间 ID。');
    // 成员 B 的真实评分调用耗时 59.09 秒（默认 responses 通路，reasoning.effort=low），超时设得过短只会得到 504。
    if(activeProvider==='bailian'&&timeoutMs<60000)
      console.warn(`警告：SCORING_TIMEOUT_MS=${timeoutMs} 小于真实调用的实测耗时（约 59 秒），建议至少 120000。`);
  }
  const server=createScoringServer({mode,provider:activeProvider,bailianTransport:activeTransport,timeoutMs});
  server.listen(port,'127.0.0.1',()=>{
    console.log(`TOPE Mate scoring server (${mode}, provider=${activeProvider}${activeProvider==='bailian'?`, transport=${activeTransport}`:''}, timeout=${timeoutMs}ms) listening on http://127.0.0.1:${port}`);
  });
}