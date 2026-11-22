/* 短回答与模型输出稳定性的离线回归测试（零真实密钥、零真实请求、零付费调用）。
   背景：TOPE C · speech 录 10 秒、转写只有两句话时，页面拿到 502 INVALID_MODEL_OUTPUT。
   AI_SCHEMA 允许每个维度 null，calculatePracticeScore 也支持缺维度重归一化权重，
   但 normalizeAIResult 原先要求「必评维度必须给整数分」，把「证据不足、无法评估」这种合法回答判成无效报告。
   本文件钉住修好之后的边界：
   ① 内容不足时未评估维度标记为 unassessed、按 null 处理，绝不按 0 分计入；
   ② 一个可用维度分都没有 → 仍然 fail closed，不产出练习分；
   ③ 原文证据校验、自带总分、非活动维度给分、缺必填字段、非法分数一律照旧拒绝；
   ④ 诊断只输出固定规则名，不回显模型原文、转写内容与密钥。 */
import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {scoreWithOpenAI} from '../src/provider.mjs';
import {scoreWithBailian,DEFAULT_BAILIAN_MODEL} from '../src/bailian-provider.mjs';
import {createScoringServer,validationReasonOf} from '../src/http-server.mjs';
import {blankResult} from '../src/contract.mjs';
import {calculateTimingScore,getPracticeScoreConfig} from '../src/practice-score.mjs';

const base=JSON.parse(readFileSync(new URL('../fixtures/c_low.json',import.meta.url),'utf8'));
// 与真实故障同口径：C 演讲 10 秒、目标 180 秒，转写只有「重述题目 + 一句理由」。
const shortRequest={...base,durationSeconds:10,targetDurationSeconds:180,
  transcript:'Why do people immigrate to other countries? Because they are poor.'};
const oneLineRequest={...shortRequest,transcript:'People immigrate for money.'};
const SENTENCE='Why do people immigrate to other countries?';
const BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1';
const FAKE_KEY='FAKE_BAILIAN_KEY_never_used';

const modelDims=req=>getPracticeScoreConfig(req).assessedDimensions.filter(k=>k!=='timeManagement');
/** 造一份「模型只给得起部分维度分」的输出：scored 里给分，其余维度按 Schema 留 null。 */
function aiOutput(req,scored){
  const b=blankResult(req,'ai');
  // 引文必须是被评文本的逐字片段，否则测试自己就先撞上证据校验。
  const quote=req.transcript.slice(0,Math.min(20,req.transcript.length));
  const scores={...b.scores};
  for(const dim of modelDims(req)) scores[dim]=Number.isInteger(scored[dim])?scored[dim]:null;
  scores.timeManagement=null;
  const feedback=modelDims(req).filter(dim=>scores[dim]!==null)
    .map(dim=>({dimension:dim,rationale:`${dim}：依据学生原文的少量证据给出判断。`,evidenceQuotes:[quote]}));
  return {...b,mode:'ai',practiceScore:null,scoreStatus:'pending',scorePolicy:null,scoreCoverage:null,
    overall:{...b.overall,score:null,label:'not_scored'},scores,dimensionFeedback:feedback,
    evidence:[{quote,observation:'学生原文作为切题证据。',dimension:'relevance'}],
    strengths:[],weaknesses:[],suggestions:[],improvedExpressions:[],nextPractice:[],errors:[]};
}
/** 与后端同一套权重复算练习分，测试不写死算术结果。 */
function expectedScore(req,scores){
  const cfg=getPracticeScoreConfig(req);
  const included=cfg.assessedDimensions.filter(k=>Number.isInteger(scores[k]));
  const weight=included.reduce((a,k)=>a+cfg.configuredWeights[k],0);
  return weight?Math.round(included.reduce((a,k)=>a+scores[k]*cfg.configuredWeights[k],0)/weight):null;
}
const responsesImpl=payload=>async()=>({ok:true,status:200,json:async()=>({
  model:DEFAULT_BAILIAN_MODEL,status:'completed',output_text:typeof payload==='string'?payload:JSON.stringify(payload)})});
const chatImpl=payload=>async()=>({ok:true,status:200,json:async()=>({
  model:DEFAULT_BAILIAN_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})});
const score=(req,payload)=>scoreWithOpenAI(req,{provider:'bailian',apiKey:FAKE_KEY,baseUrl:BASE_URL,timeoutMs:120000,fetchImpl:responsesImpl(payload)});

test('10 秒两句话回答：组织与展开留 null 时报告仍有效，两维度标为未评估而不是 0 分',async()=>{
  const payload=aiOutput(shortRequest,{relevance:45,organization:null,development:null,language:40,taskCompletion:35});
  const out=await score(shortRequest,payload);
  assert.deepEqual(out.errors,[],'证据不足而留 null 是合法输出，不该再返回 INVALID_MODEL_OUTPUT。');
  assert.equal(out.scores.organization,null);
  assert.equal(out.scores.development,null);
  assert.equal(out.scoreStatus,'partial');
  assert.ok(out.scoreCoverage.coveragePercent<100&&out.scoreCoverage.coveragePercent>0);
  assert.deepEqual(out.scoreCoverage.assessedDimensions,['relevance','language','taskCompletion','timeManagement']);
  for(const dim of ['organization','development'])assert.ok(out.unassessed.includes(dim),`${dim} 必须出现在 unassessed`);
  assert.ok(!out.dimensionFeedback.some(x=>x.dimension==='organization'||x.dimension==='development'),'未评估维度不进维度反馈，避免 validate.cjs 的分数一致性检查失败。');
  assert.equal(out.scores.timeManagement,calculateTimingScore(10,180));
  assert.equal(out.practiceScore,expectedScore(shortRequest,out.scores));
  assert.ok(out.practiceScore!==null&&out.overall.score===out.practiceScore);
  assert.equal(out.officialAssessment.level,null);
  assert.ok(!JSON.stringify(out.errors).includes(shortRequest.transcript));
});

test('一句话回答：只有 relevance 与 language 给得出分，权重仍按后端规则重归一化',async()=>{
  const payload=aiOutput(oneLineRequest,{relevance:40,language:35});
  const out=await score(oneLineRequest,payload);
  assert.deepEqual(out.errors,[]);
  assert.equal(out.scoreStatus,'partial');
  assert.deepEqual(out.scoreCoverage.assessedDimensions,['relevance','language','timeManagement']);
  assert.equal(out.practiceScore,expectedScore(oneLineRequest,out.scores));
  for(const dim of ['organization','development','taskCompletion'])assert.equal(out.scores[dim],null,`${dim} 不得被补成 0 分`);
});

test('所有可评维度都留 null：没有任何可算的分，继续 fail closed 且不产出练习分',async()=>{
  const payload=aiOutput(shortRequest,{});
  const out=await score(shortRequest,payload);
  assert.equal(out.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(validationReasonOf(out.errors[0].message),'NO_ASSESSABLE_DIMENSION_SCORE');
  assert.equal(out.practiceScore,null);
  assert.equal(out.scoreStatus,'not_scored');
  assert.ok(Object.values(out.scores).every(v=>v===null),'被拒绝的报告不得留下任何维度分。');
});

test('模型给了分却没给解释，仍按缺解释拒绝（不因放松而漏判）',async()=>{
  const payload=aiOutput(shortRequest,{relevance:45,language:40,taskCompletion:35});
  payload.dimensionFeedback=payload.dimensionFeedback.filter(x=>x.dimension!=='language');
  const out=await score(shortRequest,payload);
  assert.equal(out.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(validationReasonOf(out.errors[0].message),'MISSING_DIMENSION_RATIONALE:language');
});

test('短回答不放松原文证据校验：编造引文与编造 PEEL 原话照样拒绝且不回显',async()=>{
  const invented=aiOutput(shortRequest,{relevance:45,language:40});
  invented.evidence=[{quote:'Research shows that economic hardship is the only reason.',observation:'x',dimension:'relevance'}];
  const out=await score(shortRequest,invented);
  assert.equal(out.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(validationReasonOf(out.errors[0].message),'NON_VERBATIM_EVIDENCE');
  assert.equal(out.scores.relevance,null);
  assert.ok(!JSON.stringify(out).includes('Research shows'),'错误信息不得带出模型编造的原文。');

  const peel=aiOutput(shortRequest,{relevance:45,language:40});
  peel.peel.explain='present';
  peel.peelDetails.explain={quote:'Because people are poor.',note:'x'};
  const peelOut=await score(shortRequest,peel);
  assert.equal(validationReasonOf(peelOut.errors[0].message),'INVENTED_PEEL_QUOTE');
});

test('缺必填字段、非法分数、自带总分、非活动维度给分：一律拒绝并给出固定规则名',async()=>{
  const cases=[
    [req=>{const p=aiOutput(req,{relevance:45});delete p.improvedExpressions;return p;},'MISSING_REQUIRED_ARRAY'],
    [req=>{const p=aiOutput(req,{relevance:45});p.scores.relevance=120;return p;},'INVALID_DIMENSION_SCORE:relevance'],
    [req=>{const p=aiOutput(req,{relevance:45});p.practiceScore=88;return p;},'MODEL_RETURNED_AGGREGATE_SCORE'],
    [req=>{const p=aiOutput(req,{relevance:45});p.scores.interaction=0;return p;},'INACTIVE_DIMENSION_SCORED:interaction']
  ];
  for(const [make,reason] of cases){
    const out=await score(shortRequest,make(shortRequest));
    assert.equal(out.errors[0].code,'INVALID_MODEL_OUTPUT',reason);
    assert.equal(validationReasonOf(out.errors[0].message),reason);
    assert.equal(out.practiceScore,null,`${reason} 时不得留下练习分`);
  }
});

test('同一份短回答输出经 responses、chat 与 OpenAI 三条通路结果逐字段一致',async()=>{
  const payload=aiOutput(shortRequest,{relevance:45,organization:null,development:null,language:40,taskCompletion:35});
  const viaResponses=await score(shortRequest,payload);
  const viaChat=await scoreWithBailian(shortRequest,{apiKey:FAKE_KEY,baseUrl:BASE_URL,transport:'chat',fetchImpl:chatImpl(payload)});
  const viaOpenAI=await scoreWithOpenAI(shortRequest,{apiKey:FAKE_KEY,fetchImpl:responsesImpl(payload)});
  assert.deepEqual(viaChat,viaResponses);
  assert.deepEqual(viaOpenAI,viaResponses);
  assert.equal(viaResponses.scoreStatus,'partial');
});

test('HTTP 层：短回答的未评估报告是 200 完整 1.4.0 信封，全 null 才是 502',async()=>{
  async function withServer(payload,fn){
    const server=createScoringServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:BASE_URL,
      fetchImpl:responsesImpl(payload)});
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    try{await fn(base);}finally{server.close();await once(server,'close');}
  }
  const post=(base,body)=>fetch(`${base}/api/evaluate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  await withServer(aiOutput(shortRequest,{relevance:45,organization:null,development:null,language:40,taskCompletion:35}),async base=>{
    const res=await post(base,shortRequest);
    const body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.scoreStatus,'partial');
    assert.equal(body.data.scores.organization,null);
  });
  await withServer(aiOutput(shortRequest,{}),async base=>{
    const res=await post(base,shortRequest);
    const body=await res.json();
    assert.equal(res.status,502);
    assert.equal(body.error.code,'INVALID_MODEL_OUTPUT');
    assert.equal('reason'in body.error,false,'对外错误信封保持 {code,message,retryable} 不变。');
    assert.ok(!JSON.stringify(body).includes(shortRequest.transcript));
  });
});

test('诊断规则名只认固定文本：匹配不到一律 UNSPECIFIED，绝不带出任意原文',()=>{
  assert.equal(validationReasonOf('Evidence must quote transcript verbatim'),'NON_VERBATIM_EVIDENCE');
  assert.equal(validationReasonOf('Missing array: improvedExpressions'),'MISSING_REQUIRED_ARRAY');
  assert.equal(validationReasonOf('模型没有返回有效的结构化反馈。'),'MODEL_TEXT_NOT_JSON');
  assert.equal(validationReasonOf('百炼返回的结果不是可解析的 JSON，本次不生成评分。'),'PROVIDER_BODY_NOT_JSON');
  assert.equal(validationReasonOf(''),'UNSPECIFIED');
  assert.equal(validationReasonOf(undefined),'UNSPECIFIED');
  const leak=validationReasonOf(`TypeError: cannot read ${SENTENCE} at line 1`);
  assert.equal(leak,'UNSPECIFIED');
  assert.ok(!leak.includes('immigrate'),'诊断不得回显异常里携带的用户文本。');
});
