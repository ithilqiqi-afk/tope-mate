// 阿里云百炼（Model Studio）OpenAI 兼容通路的【非默认备用实现】。
// 默认评分通路是 provider.mjs 中成员 B 2026-11-21 真实调用实测通过的 Responses 实现
// （嵌套 text.format.json_schema、max_output_tokens=16384、reasoning.effort=low）。
// http-server.mjs 只在显式 BAILIAN_SCORING_TRANSPORT=chat 时调用本文件的 scoreWithBailian，
// 该 chat 通路从未做过真实调用验证；本文件的 responses 分支只是历史实现与单测对照，不再是线上默认路径。
// B 的评分核心（算法、权重、Schema 1.4.0、原文证据校验）已冻结，本文件不覆盖也不修改它。
// 评分算法、权重与原文证据校验全部复用 provider.mjs 的 normalizeAIResult，本文件只负责传输层与报文解析。
// 文档依据（2026-11-21 核实，help.aliyun.com/zh/model-studio/）：
//   qwen-api-via-openai-responses（创建响应）：
//     POST https://dashscope.aliyuncs.com/compatible-mode/v1/responses            ← 成员 B 2026-11-21 真实调用实测通过
//     POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses（官方推荐的北京业务空间专属域名）
//     支持模型含 qwen3.8-flash；结构化输出用 text.format，官方参数表把 schema 写在 text.format.json_schema 里，
//     store 默认 true（会保存会话响应），本项目显式传 false；未列出的 OpenAI 参数会被忽略。
//     注意：B 实测通过的默认实现用的正是官方嵌套写法 json_schema{name,strict,schema}；
//     本文件 responses 分支用的是扁平写法（type/name/strict/schema 同级），与 B 的报文不同，不得当作默认实现。
//   qwen-api-via-openai-chat-completions：
//     POST {base}/chat/completions，结构化输出用 response_format.type=json_schema，且开启时不得设置 max_tokens。
//   qwen-structured-output：JSON Schema 模式支持 Qwen3.8-Flash 系列。
// chat 通路不写 max_tokens，截断由 finish_reason:"length" 拦截；本文件 responses 分支写
// max_output_tokens=BAILIAN_MAX_OUTPUT_TOKENS，截断由 status:"incomplete" 拦截。两者都绝不交半份分数。
import {validateRequest,blankResult,hasInteractionEvidence} from './contract.mjs';
import {rubricFor,officialBasisFor,PRACTICE_RUBRIC_VERSION} from './rubrics.mjs';
import {AI_SCHEMA} from './ai-schema.mjs';
import {getPracticeScoreConfig,SCORE_ANCHORS,PROMPT_VERSION} from './practice-score.mjs';
import {normalizeAIResult,SYSTEM_PROMPT} from './provider.mjs';
import {readFileSync} from 'node:fs';

const OFFICIAL_BANDS=JSON.parse(readFileSync(new URL('../data/official_rating_descriptors.json',import.meta.url),'utf8')).exams;

export const DEFAULT_BAILIAN_MODEL='qwen3.8-flash';
/**
 * 成员 B 2026-11-21 用团队 Key 实测通过的评分地址（北京地域通用域名，官方说明「现有域名仍可正常使用」）。
 * 官方同时推荐业务空间专属域名 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1，
 * 需要时用 BAILIAN_BASE_URL 覆盖即可；本仓库不硬编码任何真实业务空间 ID。
 */
export const DEFAULT_BAILIAN_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1';
export const BAILIAN_SCHEMA_NAME='tope_practice_feedback';
export const WORKSPACE_ID_PLACEHOLDER='{WorkspaceId}';
/** responses = 默认接口名，默认由 provider.mjs 的 B 实测实现处理；chat = 本文件的备用接口。 */
export const BAILIAN_TRANSPORTS=Object.freeze(['responses','chat']);
export const DEFAULT_BAILIAN_TRANSPORT='responses';
/** 官方 reasoning.effort 对 qwen3.8-flash 支持的档位；仅本备用通路读取，留空即不发送（模型默认 xhigh）。默认 responses 通路由 B 的实现固定 effort=low。 */
export const REASONING_EFFORTS=Object.freeze(['none','low','medium','high','xhigh']);
/**
 * 本文件 responses 备用分支的输出上限，与 B 默认实现的 16384 不同；
 * 成员 B 2026-11-21 在 59.09 秒内拿到完整报告用的是 B 的报文，不是这一份。
 * 官方：达到上限时生成提前停止、status=incomplete，本通路把它拦成 PROVIDER_INCOMPLETE，绝不交半份分数。
 */
export const BAILIAN_MAX_OUTPUT_TOKENS=3600;

/** 供应商接口名只影响传输层；非法值在构造服务时就要抛出，而不是等到出网前。 */
export function resolveBailianTransport(value){
  const name=String(value||DEFAULT_BAILIAN_TRANSPORT).trim().toLowerCase();
  if(!BAILIAN_TRANSPORTS.includes(name)) throw new RangeError(`Unsupported BAILIAN_SCORING_TRANSPORT: ${value}`);
  return name;
}

/** 只接受填好的真实地址：占位符、空值、非 https 都在出网前拒绝。 */
function bailianRootUrl(baseUrl){
  const value=String(baseUrl||'').trim().replace(/\/+$/,'');
  if(!value) throw new RangeError('未配置 BAILIAN_BASE_URL。');
  if(value.includes(WORKSPACE_ID_PLACEHOLDER)) throw new RangeError('BAILIAN_BASE_URL 里的 {WorkspaceId} 需要替换为控制台「业务空间详情」中的真实业务空间 ID，或直接改用 https://dashscope.aliyuncs.com/compatible-mode/v1。');
  if(!/^https:\/\//i.test(value)) throw new RangeError('BAILIAN_BASE_URL 必须以 https:// 开头。');
  return value.replace(/\/(chat\/completions|responses)$/i,'');
}

export function bailianChatUrl(baseUrl){
  return `${bailianRootUrl(baseUrl)}/chat/completions`;
}

export function bailianResponsesUrl(baseUrl){
  return `${bailianRootUrl(baseUrl)}/responses`;
}

export function bailianUrlFor(transport,baseUrl){
  return resolveBailianTransport(transport)==='chat'?bailianChatUrl(baseUrl):bailianResponsesUrl(baseUrl);
}

function errorResult(req,code,message){
  const out=blankResult(req,'ai');out.errors=[{code,message}];return out;
}

/** Chat Completions 的文本在 choices[0].message.content；兼容 content 为分段数组的返回。 */
function textFromChat(payload){
  const message=(Array.isArray(payload?.choices)?payload.choices[0]:null)?.message;
  if(message&&typeof message.refusal==='string'&&message.refusal.trim())throw new Error('PROVIDER_REFUSAL');
  const content=message?.content;
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.map(part=>typeof part==='string'?part:(part&&typeof part.text==='string'?part.text:'')).join('');
  throw new Error('PROVIDER_NO_TEXT');
}

/**
 * Responses 的文本解析与 provider.mjs 的 getText 逐行同构：
 * 优先 output_text，其次 output[] 里 type==='message' 的 content[].text，遇 refusal 视为模型拒答。
 */
function textFromResponses(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text;
  for(const item of payload?.output||[]){
    if(item?.type!=='message')continue;
    for(const c of item.content||[]){
      if(c?.type==='refusal')throw new Error('PROVIDER_REFUSAL');
      if(c?.type==='output_text'&&typeof c.text==='string')return c.text;
    }
  }
  throw new Error('PROVIDER_NO_TEXT');
}

/** 送给模型的输入与 OpenAI 通路逐字段一致：questionId 只是前端跟踪标签，不进模型。 */
function modelInput(request){
  const focus=rubricFor(request);
  const scoreConfig=getPracticeScoreConfig(request);
  const {questionId,...modelRequest}=request;
  return JSON.stringify({request:modelRequest,
    practiceRubric:{version:PRACTICE_RUBRIC_VERSION,focus:focus.focus,officialBasis:officialBasisFor(request),peelIsOfficialCriterion:false},
    practiceScoreConfig:{version:scoreConfig.version,promptVersion:PROMPT_VERSION,label:scoreConfig.label,weightBasis:'product_defined_not_official',
      weights:scoreConfig.configuredWeights,assessedDimensions:scoreConfig.assessedDimensions,notAssessedDimensions:scoreConfig.notAssessedDimensions,
      descriptions:scoreConfig.descriptions,scoreAnchors:SCORE_ANCHORS,aggregateCalculation:'backend_only'},
    interactionEvidenceAvailable:hasInteractionEvidence(request),
    officialBands:OFFICIAL_BANDS[request.examType]});
}

/**
 * 服务端专用：百炼密钥只从环境变量读取，绝不接受 OpenAI 密钥回退，
 * 也绝不把密钥、请求原文或供应商响应体写进任何返回消息。
 */
export async function scoreWithBailian(request,{
  apiKey=process.env.BAILIAN_API_KEY||process.env.DASHSCOPE_API_KEY,
  model=process.env.BAILIAN_MODEL||DEFAULT_BAILIAN_MODEL,
  baseUrl=process.env.BAILIAN_BASE_URL||DEFAULT_BAILIAN_BASE_URL,
  transport=process.env.BAILIAN_SCORING_TRANSPORT||DEFAULT_BAILIAN_TRANSPORT,
  reasoningEffort=process.env.BAILIAN_SCORING_REASONING_EFFORT||'',
  fetchImpl=globalThis.fetch,
  timeoutMs=120000,
  enableThinking=false
}={}){
  validateRequest(request);
  if(!request.transcript.trim())return blankResult(request,'ai');
  if(!apiKey) return errorResult(request,'API_KEY_MISSING','服务器尚未配置 BAILIAN_API_KEY（或 DASHSCOPE_API_KEY），无法调用百炼评分。');
  let activeTransport;
  try{activeTransport=resolveBailianTransport(transport);}
  catch(err){return errorResult(request,'PROVIDER_CONFIG_ERROR',`${err.message}`);}
  let url;
  try{url=bailianUrlFor(activeTransport,baseUrl);}
  catch(err){return errorResult(request,'PROVIDER_CONFIG_ERROR',`${err.message}`);}
  if(typeof fetchImpl!=='function') return errorResult(request,'FETCH_UNAVAILABLE','运行环境不支持 fetch。请使用 Node.js 18+。');
  const input=modelInput(request);
  const body=activeTransport==='chat'
    // 提示词保持 v0.6 原文，两条通路与 OpenAI 通路的比较键才仍然成立。
    ? {model,stream:false,enable_thinking:enableThinking===true,
       messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:input}],
       response_format:{type:'json_schema',json_schema:{name:BAILIAN_SCHEMA_NAME,strict:true,schema:AI_SCHEMA}}}
    // 备用 responses 报文：扁平 text.format + 3600 token，与 B 默认实现（嵌套 json_schema + 16384 + effort=low）不同，未经真实调用验证。
    : {model,stream:false,store:false,instructions:SYSTEM_PROMPT,input,
       text:{format:{type:'json_schema',name:BAILIAN_SCHEMA_NAME,strict:true,schema:AI_SCHEMA}},
       max_output_tokens:BAILIAN_MAX_OUTPUT_TOKENS};
  // 官方：Responses 用 reasoning.effort 控制思考强度；本备用通路不发送该参数即模型默认（qwen3.8-flash 为 xhigh）。
  if(activeTransport==='responses'&&reasoningEffort)body.reasoning={effort:reasoningEffort};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(timeoutMs,300000)));
  try{
    const res=await fetchImpl(url,{
      method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:controller.signal});
    if(res.status===401||res.status===403)
      return errorResult(request,'PROVIDER_AUTH_ERROR',`百炼鉴权或调用权限校验未通过（HTTP ${res.status}）。`);
    if(res.status===404)
      return errorResult(request,'PROVIDER_MODEL_UNAVAILABLE',`百炼未找到该模型或接口（HTTP 404），请核对模型 ID、接口路径与地域。`);
    if(!res.ok)
      return errorResult(request,'PROVIDER_HTTP_ERROR',`百炼模型服务暂时不可用（HTTP ${res.status}）。请重试或使用离线模式。`);
    let payload;
    try{payload=await res.json();}
    catch{return errorResult(request,'INVALID_MODEL_OUTPUT','百炼返回的结果不是可解析的 JSON，本次不生成评分。');}
    const choice=Array.isArray(payload?.choices)?payload.choices[0]:null;
    if((choice&&choice.finish_reason==='length')||payload?.status==='incomplete')
      return errorResult(request,'PROVIDER_INCOMPLETE','模型输出被长度上限截断，本次不生成评分，请重试。');
    let obj;
    try{
      const text=activeTransport==='chat'?textFromChat(payload):textFromResponses(payload);
      obj=JSON.parse(text);
    }
    catch(err){return errorResult(request,err.message==='PROVIDER_REFUSAL'?'PROVIDER_REFUSAL':'INVALID_MODEL_OUTPUT','模型没有返回有效的结构化反馈。');}
    try{return normalizeAIResult(obj,request,{modelId:typeof payload.model==='string'&&payload.model?payload.model:model});}
    catch(err){return errorResult(request,'INVALID_MODEL_OUTPUT',`模型结果未通过评分或原文证据校验：${err.message}`);}
  }catch(err){
    const timeout=err.name==='AbortError';
    return errorResult(request,timeout?'PROVIDER_TIMEOUT':'PROVIDER_NETWORK_ERROR',timeout?'模型响应超时。':'模型服务连接失败。');
  }finally{clearTimeout(timer);}
}
