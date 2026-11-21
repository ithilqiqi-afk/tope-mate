import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {validateRequest,SCHEMA_VERSION} from './contract.mjs';
import {scoreHeuristic} from './scorer.mjs';
import {scoreWithOpenAI} from './provider.mjs';

export const MAX_BODY_BYTES = 128*1024;
export const ALLOWED_ORIGINS = new Set(['http://localhost:5173','http://127.0.0.1:5173']);
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
  PROVIDER_TIMEOUT:{status:504,message:'模型响应超时，请稍后重试或使用离线模式。',retryable:true}
};

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

export function createScoringServer({mode='heuristic',apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL,fetchImpl=globalThis.fetch,timeoutMs=45000}={}){
  if(mode!=='heuristic' && mode!=='ai') throw new RangeError(`Unsupported SCORING_MODE: ${mode}`);
  return http.createServer(async (req,res)=>{
    try{
      const path=(req.url||'').split('?')[0];
      if(req.method==='OPTIONS'){
        if(corsHeaders(req)['Access-Control-Allow-Origin']){res.writeHead(204,corsHeaders(req));res.end();}
        else sendError(req,res,403,'CORS_FORBIDDEN','该来源不被允许跨域访问。');
        return;
      }
      if(path==='/health' && req.method==='GET'){
        sendJson(req,res,200,{success:true,data:{status:'ok',mode,schemaVersion:SCHEMA_VERSION,moduleVersion:MODULE_VERSION,aiKeyConfigured:Boolean(apiKey)},meta:{questionId:null,demoOnly:false}});
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
        if(mode==='ai' && !apiKey) return sendScoringError(req,res,'API_KEY_MISSING');
        const result=mode==='ai'
          ? await scoreWithOpenAI(request,{apiKey,model,fetchImpl,timeoutMs})
          : scoreHeuristic(request);
        if(Array.isArray(result.errors) && result.errors.length>0) return sendScoringError(req,res,result.errors[0].code);
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
  const port=Number(process.env.PORT||3001);
  if(mode!=='heuristic' && mode!=='ai'){
    console.error(`SCORING_MODE 仅支持 heuristic 或 ai，收到：${mode}`);
    process.exit(1);
  }
  if(mode==='ai' && !process.env.OPENAI_API_KEY)
    console.warn('警告：SCORING_MODE=ai 但未配置 OPENAI_API_KEY，/api/evaluate 将返回 503。');
  const server=createScoringServer({mode});
  server.listen(port,'127.0.0.1',()=>{
    console.log(`TOPE Mate scoring server (${mode}) listening on http://127.0.0.1:${port}`);
  });
}