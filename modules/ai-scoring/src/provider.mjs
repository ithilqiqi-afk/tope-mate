import {validateRequest,blankResult,validateResponse,hasInteractionEvidence,SCHEMA_VERSION} from './contract.mjs';
import {analyzeText} from './diagnostics.mjs';
import {rubricFor,DIMENSIONS,DISCLAIMER,officialBasisFor,PRACTICE_RUBRIC_VERSION} from './rubrics.mjs';
import {AI_SCHEMA} from './ai-schema.mjs';
import {getPracticeScoreConfig,calculatePracticeScore,SCORE_ANCHORS,SCORE_DISCLAIMER,PROMPT_VERSION} from './practice-score.mjs';
import {readFileSync} from 'node:fs';
const OFFICIAL_BANDS=JSON.parse(readFileSync(new URL('../data/official_rating_descriptors.json',import.meta.url),'utf8')).exams;

const SYSTEM_PROMPT=readFileSync(new URL('../prompts/system_prompt.txt',import.meta.url),'utf8').trim();

const getText = body => {
  if(typeof body.output_text==='string' && body.output_text.trim())return body.output_text;
  for(const item of body.output||[]){
    if(item.type==='message')for(const c of item.content||[]){
      if(c.type==='refusal')throw new Error('PROVIDER_REFUSAL');
      if(c.type==='output_text' && typeof c.text==='string')return c.text;
    }
  }
  throw new Error('PROVIDER_NO_TEXT');
};
function errorResult(req,code,message){
  const out=blankResult(req,'ai');out.errors=[{code,message}];return out;
}
export function normalizeAIResult(raw,req,{modelId='unconfigured'}={}){
  validateResponse(raw,req,{requireAi:true});
  const config=getPracticeScoreConfig(req);
  if(raw.practiceScore!==null || raw.overall?.score!==null || raw.officialAssessment?.level!==null)
    throw new Error('Model must not return an aggregate practice score or official level');
  const activeModelDims=config.assessedDimensions.filter(k=>k!=='timeManagement');
  const feedbackByDim=new Map(raw.dimensionFeedback.map(x=>[x.dimension,x]));
  // AI_SCHEMA 允许每个维度留 null，calculatePracticeScore 也支持「缺哪个维度就重新归一化哪个权重」，
  // 所以短回答里模型把组织/展开判为「证据不足、无法评估」不是无效报告：该维度按未评估处理，不按 0 分处理。
  // 仍然 fail closed 的两条：给了分就必须给文字解释；一个可用维度分都没有，就没有任何练习分可算。
  for(const dim of activeModelDims){
    if(Number.isInteger(raw.scores[dim])&&!feedbackByDim.has(dim)) throw new Error(`Missing dimension rationale: ${dim}`);
  }
  if(!activeModelDims.some(dim=>Number.isInteger(raw.scores[dim]))) throw new Error('No assessable dimension score in model output');
  for(const dim of DIMENSIONS){
    if(!activeModelDims.includes(dim) && raw.scores[dim]!==null) throw new Error(`Inactive dimension must be null: ${dim}`);
  }
  const scoreResult=calculatePracticeScore(req,raw.scores,{modelId});
  const clean=structuredClone(raw);
  clean.schemaVersion=SCHEMA_VERSION;
  clean.practiceScore=scoreResult.practiceScore;
  clean.scoreVersion=scoreResult.scorePolicy.version;
  clean.scoreStatus=scoreResult.scoreStatus;
  clean.scorePolicy=scoreResult.scorePolicy;
  clean.scoreCoverage=scoreResult.scoreCoverage;
  clean.scores=scoreResult.scores;
  clean.overall={score:scoreResult.practiceScore,maxScore:100,label:scoreResult.practiceScore===null?'not_scored':'practice_reference',disclaimer:DISCLAIMER};
  clean.rubricBasis=officialBasisFor(req);
  clean.officialAssessment=blankResult(req,'ai').officialAssessment;
  const normalizedDetails=[];
  for(const dim of scoreResult.scoreCoverage.assessedDimensions){
    if(dim==='timeManagement'){
      normalizedDetails.push({dimension:dim,score:scoreResult.scores[dim],weight:scoreResult.scorePolicy.configuredWeights[dim],normalizedWeight:Math.round(scoreResult.scorePolicy.configuredWeights[dim]/scoreResult.scoreCoverage.assessedWeight*1000)/10,rationale:`实际录音 ${req.durationSeconds} 秒，目标时长 ${req.targetDurationSeconds} 秒；该维度由固定产品规则根据时长偏差计算，不是官方换算。`,evidenceQuotes:[]});
      continue;
    }
    const item=feedbackByDim.get(dim);
    normalizedDetails.push({dimension:dim,score:scoreResult.scores[dim],weight:scoreResult.scorePolicy.configuredWeights[dim],normalizedWeight:Math.round(scoreResult.scorePolicy.configuredWeights[dim]/scoreResult.scoreCoverage.assessedWeight*1000)/10,rationale:item.rationale,evidenceQuotes:item.evidenceQuotes});
  }
  clean.dimensionFeedback=normalizedDetails;
  if(!(req.examType==='C'&&req.stage==='speech')&&!(req.examType==='B'&&req.stage==='statement')){
    for(const k of ['point','explain','example','link']){
      clean.peel[k]='not_assessed';
      clean.peelDetails[k]={quote:null,note:'此阶段不要求 PEEL；PEEL 也不是人大官方独立评分维度。'};
    }
  }
  const diag=analyzeText(req.transcript,req.durationSeconds,req.targetDurationSeconds);
  clean.diagnostics={wordCount:diag.wordCount,detectedSignals:diag.detectedSignals,timingNote:diag.timingNote};
  // The model declares timeManagement unassessed, but the backend scores it when a target duration exists.
  clean.unassessed=[...new Set([...clean.unassessed,'pronunciation','prosody','audio_fluency',...scoreResult.scoreCoverage.notAssessedDimensions,
    ...((req.examType==='B'&&req.stage==='discussion'&&!hasInteractionEvidence(req))?['group_interaction_without_speaker_turns']:[])])].filter(k=>!(k in clean.scores)||clean.scores[k]===null);
  clean.errors=[];
  return clean;
}
const PROVIDERS={
  openai:{keyEnv:'OPENAI_API_KEY',modelEnv:'OPENAI_MODEL',defaultModel:'gpt-4o-mini',defaultBaseUrl:'https://api.openai.com/v1',maxOutputTokens:3600,defaultTimeoutMs:45000},
  // Qwen3.8 counts reasoning tokens against max_output_tokens, so the cap must cover thinking + report.
  // effort=low keeps latency bounded: a real qwen3.8-flash call at default effort took ~119s, past the old 45s cap.
  bailian:{keyEnv:'DASHSCOPE_API_KEY',modelEnv:'BAILIAN_MODEL',defaultModel:'qwen3.8-flash',baseUrlEnv:'BAILIAN_BASE_URL',defaultBaseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',maxOutputTokens:16384,defaultTimeoutMs:120000}
};
export const SCORING_PROVIDERS=Object.keys(PROVIDERS);
export function resolveTimeoutMs(provider,timeoutMs){
  const raw=timeoutMs!==undefined?timeoutMs:(process.env.SCORING_TIMEOUT_MS!==undefined?Number(process.env.SCORING_TIMEOUT_MS):PROVIDERS[provider].defaultTimeoutMs);
  return Math.max(1000,Math.min(Number.isFinite(raw)?raw:PROVIDERS[provider].defaultTimeoutMs,120000));
}
/** Server-side only. Never call directly from public browser with an API key. */
export async function scoreWithOpenAI(request,{provider=process.env.SCORING_PROVIDER||'openai',apiKey,model,baseUrl,fetchImpl=globalThis.fetch,timeoutMs}={}){
  validateRequest(request);
  const cfg=PROVIDERS[provider];
  if(!cfg)throw new RangeError(`Unsupported SCORING_PROVIDER: ${provider}`);
  const resolvedKey=apiKey!==undefined?apiKey:process.env[cfg.keyEnv];
  const resolvedModel=model||process.env[cfg.modelEnv]||cfg.defaultModel;
  const resolvedBaseUrl=(baseUrl||(cfg.baseUrlEnv&&process.env[cfg.baseUrlEnv])||cfg.defaultBaseUrl).replace(/\/+$/,'');
  if(!request.transcript.trim())return blankResult(request,'ai');
  if(!resolvedKey) return errorResult(request,'API_KEY_MISSING',`服务器尚未配置 ${cfg.keyEnv}。`);
  if(typeof fetchImpl!=='function') return errorResult(request,'FETCH_UNAVAILABLE','运行环境不支持 fetch。请使用 Node.js 18+。');
  const focus=rubricFor(request);
  const scoreConfig=getPracticeScoreConfig(request);
  // questionId is a client-side tracking label only; it must not influence the model.
  const {questionId,...modelRequest}=request;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),resolveTimeoutMs(provider,timeoutMs));
  try{
    // Bailian nests name/schema/strict under format.json_schema; OpenAI keeps them flat on format.
    const format=provider==='bailian'
      ?{type:'json_schema',json_schema:{name:'tope_practice_feedback',strict:true,schema:AI_SCHEMA}}
      :{type:'json_schema',name:'tope_practice_feedback',strict:true,schema:AI_SCHEMA};
    const res=await fetchImpl(`${resolvedBaseUrl}/responses`,{
      method:'POST',headers:{'Authorization':`Bearer ${resolvedKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:resolvedModel,store:false,
        instructions:SYSTEM_PROMPT,
        input:JSON.stringify({request:modelRequest,practiceRubric:{version:PRACTICE_RUBRIC_VERSION,focus:focus.focus,officialBasis:officialBasisFor(request),peelIsOfficialCriterion:false},
          practiceScoreConfig:{version:scoreConfig.version,promptVersion:PROMPT_VERSION,label:scoreConfig.label,weightBasis:'product_defined_not_official',weights:scoreConfig.configuredWeights,assessedDimensions:scoreConfig.assessedDimensions,notAssessedDimensions:scoreConfig.notAssessedDimensions,descriptions:scoreConfig.descriptions,scoreAnchors:SCORE_ANCHORS,aggregateCalculation:'backend_only'},
          interactionEvidenceAvailable:hasInteractionEvidence(request),officialBands:OFFICIAL_BANDS[request.examType]}),
        text:{format},
        max_output_tokens:cfg.maxOutputTokens,
        ...(provider==='bailian'?{reasoning:{effort:'low'}}:{})}),signal:controller.signal});
    if(!res.ok) return errorResult(request,'PROVIDER_HTTP_ERROR',`模型服务暂时不可用（HTTP ${res.status}）。请重试或使用离线模式。`);
    const body=await res.json();
    if(body.status==='incomplete')return errorResult(request,'PROVIDER_INCOMPLETE','模型输出不完整，请重试。');
    let obj;
    try{obj=JSON.parse(getText(body));}
    catch(err){return errorResult(request,err.message==='PROVIDER_REFUSAL'?'PROVIDER_REFUSAL':'INVALID_MODEL_OUTPUT','模型没有返回有效的结构化反馈。');}
    try{return normalizeAIResult(obj,request,{modelId:typeof body.model==='string'&&body.model?body.model:resolvedModel});}
    catch(err){return errorResult(request,'INVALID_MODEL_OUTPUT',`模型结果未通过评分或原文证据校验：${err.message}`);}
  }catch(err){
    const timeout=err.name==='AbortError';
    return errorResult(request,timeout?'PROVIDER_TIMEOUT':'PROVIDER_NETWORK_ERROR',timeout?'模型响应超时。':'模型服务连接失败。');
  }finally{clearTimeout(timer);}
}
export {SYSTEM_PROMPT};
