/* 阿里云百炼评分通路的离线模拟测试：不发真实请求、不使用真实密钥、不产生任何付费调用。
   覆盖任务书要求：北京地域 Base URL 配置、模型名称配置、百炼评分请求结构、
   评分 JSON 解析、鉴权失败、模型不存在/地域不可用、网络中断与超时，
   以及「同一份模型输出经两条通路必须得到逐字段一致的报告」（证明核心算法未被改动）。
   本文件原名 bailian-provider.test.mjs，合并 PR #4 时改名，避免与 B 的同名套件互相覆盖；断言一条未改。 */
import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreWithBailian,bailianChatUrl,DEFAULT_BAILIAN_MODEL,BAILIAN_SCHEMA_NAME,WORKSPACE_ID_PLACEHOLDER} from '../src/bailian-provider.mjs';
import {scoreWithOpenAI,SYSTEM_PROMPT} from '../src/provider.mjs';
import {blankResult} from '../src/contract.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';
import {getPracticeScoreConfig} from '../src/practice-score.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high'),discuss=fixture('b_discussion_no_turns');
// 结构与官方文档一致，主机名与密钥都是伪造值。
const BEIJING_BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const BEIJING_URL=`${BEIJING_BASE}/chat/completions`;
const FAKE_KEY='BAILIAN_FAKE_KEY_do_not_use';
/* 本文件专测非默认备用 chat 通路：线上默认 responses 由成员 B 实测通过的 provider.mjs 处理
   （HTTP 层选路断言见 tests/bailian-default-routing.test.mjs），所以这里显式钉住 transport，
   保证对 /chat/completions 报文的硬断言不会因为默认值变化而失去意义。 */
const OPT={apiKey:FAKE_KEY,baseUrl:BEIJING_BASE,transport:'chat'};

const modelDimensions=req=>getPracticeScoreConfig(req).assessedDimensions.filter(x=>x!=='timeManagement');
const cannedAi=(req,overrides={})=>{
  const base=blankResult(req,'ai');
  const scores={...base.scores};
  for(const dim of modelDimensions(req)) scores[dim]=80;
  const quote=req.transcript.slice(0,Math.min(24,req.transcript.length));
  const dimensionFeedback=modelDimensions(req).map(d=>({dimension:d,rationale:`${d} 的练习表现判断有文本依据。`,evidenceQuotes:quote?[quote]:[]}));
  return {...base,mode:'ai',practiceScore:null,scoreStatus:'pending',scorePolicy:null,scoreCoverage:null,
    overall:{...base.overall,score:null,label:'not_scored'},scores,dimensionFeedback,
    evidence:quote?[{quote,observation:'引用学生原文作为评价依据',dimension:'relevance'}]:[],errors:[],...overrides};
};
/** Chat Completions 非流式响应形态（help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions）。 */
const chatAnswer=(payload,{model='test-model',finishReason='stop',refusal}={})=>chatRaw(JSON.stringify(payload),{model,finishReason,refusal});
const chatRaw=(content,{model='test-model',finishReason='stop',refusal}={})=>({
  model,choices:[{finish_reason:finishReason,index:0,message:refusal!==undefined?{refusal}:{content}}]
});
function recorder(){
  const calls=[];
  const fn=(response,{status=200}={})=>async(url,init)=>{
    calls.push({url,init,body:JSON.parse(init.body)});
    return {ok:status>=200&&status<300,status,json:async()=>response};
  };
  const never=async()=>{throw new Error('离线测试不允许发出真实请求。');};
  return {calls,fn,never};
}

test('北京地域 Base URL 解析为 Chat Completions 端点，占位符与明文 http 在出网前被拒绝',()=>{
  assert.equal(bailianChatUrl(BEIJING_BASE),BEIJING_URL);
  assert.equal(bailianChatUrl(`${BEIJING_BASE}/`),BEIJING_URL);
  assert.equal(bailianChatUrl(BEIJING_URL),BEIJING_URL);
  // 官方仍支持通用域名，两条地址都只补到 /chat/completions。
  assert.equal(bailianChatUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.ok(!bailianChatUrl(BEIJING_BASE).includes(WORKSPACE_ID_PLACEHOLDER));
  assert.throws(()=>bailianChatUrl(`https://${WORKSPACE_ID_PLACEHOLDER}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`),/WorkspaceId/);
  assert.throws(()=>bailianChatUrl(''),/BAILIAN_BASE_URL/);
  assert.throws(()=>bailianChatUrl('http://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),/https/);
});

test('百炼评分请求走 Chat Completions：严格 JSON Schema、默认 qwen3.8-flash、不设 max_tokens',async()=>{
  const rec=recorder();
  await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(rec.calls.length,1);
  assert.equal(rec.calls[0].url,BEIJING_URL);
  assert.equal(rec.calls[0].init.method,'POST');
  assert.equal(rec.calls[0].init.headers.Authorization,`Bearer ${FAKE_KEY}`);
  const body=rec.calls[0].body;
  assert.equal(body.model,DEFAULT_BAILIAN_MODEL);
  assert.equal(body.model,'qwen3.8-flash');
  assert.equal(body.stream,false);
  assert.equal(body.enable_thinking,false);
  assert.equal(body.messages.length,2);
  assert.equal(body.messages[0].role,'system');
  assert.equal(body.messages[0].content,SYSTEM_PROMPT,'两条通路必须共用成员 B 的评分提示词。');
  assert.equal(body.messages[1].role,'user');
  assert.equal(body.response_format.type,'json_schema');
  assert.equal(body.response_format.json_schema.name,BAILIAN_SCHEMA_NAME);
  assert.equal(body.response_format.json_schema.strict,true);
  assert.deepEqual(body.response_format.json_schema.schema,AI_SCHEMA,'百炼必须收到与 OpenAI 通路完全相同的封闭 Schema。');
  // 官方：开启结构化输出时请勿设置 max_tokens；Responses API 专有字段也不该出现。
  for(const forbidden of ['max_tokens','max_completion_tokens','max_output_tokens','store','instructions','input','text'])
    assert.ok(!(forbidden in body),`百炼请求不应包含 ${forbidden}`);
});

test('模型输入与 OpenAI 通路同构：只有文本与评分口径，questionId 不进模型',async()=>{
  const rec=recorder();
  await scoreWithBailian({...high,questionId:'c-speech-001'},{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  const sent=JSON.parse(rec.calls[0].body.messages[1].content);
  assert.equal(sent.request.transcript,high.transcript);
  assert.equal(sent.request.questionId,undefined);
  assert.equal(sent.request.examType,'C');
  assert.equal(sent.request.stage,'speech');
  assert.equal(sent.practiceScoreConfig.weightBasis,'product_defined_not_official');
  assert.equal(sent.practiceScoreConfig.weights.relevance,30);
  assert.equal(sent.practiceScoreConfig.aggregateCalculation,'backend_only');
  assert.equal(sent.practiceRubric.peelIsOfficialCriterion,false);
  assert.equal(sent.interactionEvidenceAvailable,false);
  assert.ok(sent.officialBands,'官方 1–6 级描述仍作为定性锚点随请求下发');
});

test('BAILIAN_MODEL 可覆盖默认模型 ID，非法业务空间地址不会变成请求',async()=>{
  const rec=recorder();
  await scoreWithBailian(high,{...OPT,model:'qwen3.8-flash-2026-01',fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(rec.calls[0].body.model,'qwen3.8-flash-2026-01');
  const bad=recorder();
  const out=await scoreWithBailian(high,{...OPT,baseUrl:'',fetchImpl:bad.never});
  assert.equal(bad.calls.length,0);
  assert.equal(out.errors[0].code,'PROVIDER_CONFIG_ERROR');
});

test('百炼响应解析：练习分由后端计算，官方等级保持 null，模式为 ai',async()=>{
  const rec=recorder();
  const out=await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(out.errors.length,0);
  assert.equal(out.schemaVersion,'1.4.0');
  assert.equal(out.mode,'ai');
  assert.equal(out.scoreStatus,'complete');
  assert.equal(out.practiceScore,82);
  assert.equal(out.scorePolicy.modelId,'test-model');
  assert.equal(out.officialAssessment.level,null);
  assert.equal(out.officialAssessment.status,'not_predicted');
  assert.ok(out.unassessed.includes('pronunciation'),'发音/语调不在文本可评估范围内。');
  assert.equal(out.scores.relevance,80);
});

test('同一份模型输出经百炼与 OpenAI 通路得到逐字段一致的报告',async()=>{
  const payload=cannedAi(high);
  const viaBailian=await scoreWithBailian(high,{...OPT,fetchImpl:async()=>({ok:true,status:200,json:async()=>chatAnswer(payload)})});
  const viaOpenAI=await scoreWithOpenAI(high,{apiKey:FAKE_KEY,model:'test-model',
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'completed',model:'test-model',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]})})});
  assert.equal(viaBailian.errors.length,0);
  assert.deepEqual(viaBailian,viaOpenAI);
});

test('模型自带总分、预测官方等级或编造原文证据时一律 fail closed',async()=>{
  const rec=recorder();
  const impl=rec.fn;
  const agg=await scoreWithBailian(high,{...OPT,fetchImpl:impl(chatAnswer(cannedAi(high,{practiceScore:88})))});
  assert.equal(agg.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(agg.practiceScore,null);
  const withLevel=cannedAi(high);
  withLevel.officialAssessment={...withLevel.officialAssessment,level:5};
  const lvl=await scoreWithBailian(high,{...OPT,fetchImpl:impl(chatAnswer(withLevel))});
  assert.equal(lvl.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(lvl.officialAssessment.level,null,'被拒绝的报告不得留下等级预测。');
  const invented=await scoreWithBailian(high,{...OPT,fetchImpl:impl(chatAnswer(cannedAi(high,{evidence:[{quote:'NEVER SAID THIS',observation:'x',dimension:'language'}]})))});
  assert.equal(invented.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(invented.scores.relevance,null,'校验失败时不采用任何维度分。');
});

test('B 侧讨论缺少真实轮次时互动维度不评分，模型塞分即被拒绝',async()=>{
  const rec=recorder();
  const ok=await scoreWithBailian(discuss,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(discuss)))});
  assert.equal(ok.errors.length,0);
  assert.equal(ok.scores.interaction,null);
  assert.deepEqual(ok.scoreCoverage.notAssessedDimensions,['interaction']);
  assert.ok(ok.unassessed.includes('group_interaction_without_speaker_turns'));
  const withTurnsScore=cannedAi(discuss);
  withTurnsScore.scores.interaction=75;
  withTurnsScore.dimensionFeedback=[...withTurnsScore.dimensionFeedback,{dimension:'interaction',rationale:'互动表现良好。',evidenceQuotes:[discuss.transcript.slice(0,24)]}];
  const bad=await scoreWithBailian(discuss,{...OPT,fetchImpl:rec.fn(chatAnswer(withTurnsScore))});
  assert.equal(bad.errors[0].code,'INVALID_MODEL_OUTPUT');
});

test('鉴权失败、模型不存在与限流分别映射为可诊断错误码',async()=>{
  for(const [status,expected] of [[401,'PROVIDER_AUTH_ERROR'],[403,'PROVIDER_AUTH_ERROR'],[404,'PROVIDER_MODEL_UNAVAILABLE'],[429,'PROVIDER_HTTP_ERROR'],[500,'PROVIDER_HTTP_ERROR'],[503,'PROVIDER_HTTP_ERROR']]){
    const rec=recorder();
    const out=await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn({}, {status})});
    assert.equal(rec.calls.length,1);
    assert.equal(out.errors[0].code,expected,`HTTP ${status}`);
    assert.ok(out.errors[0].message.includes(String(status)));
    assert.ok(!out.errors[0].message.includes(FAKE_KEY),'错误消息不得回显密钥。');
    assert.ok(!out.errors[0].message.includes('llm-placeholder'),'错误消息不得回显业务空间地址。');
  }
});

test('超时、断网与非流式截断都归入明确错误，不产出分数',async()=>{
  const abort=async()=>{const err=new Error('This operation was aborted');err.name='AbortError';throw err;};
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:abort})).errors[0].code,'PROVIDER_TIMEOUT');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:async()=>{throw new Error('socket hang up')}})).errors[0].code,'PROVIDER_NETWORK_ERROR');
  const rec=recorder();
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high),{finishReason:'length'}))})).errors[0].code,'PROVIDER_INCOMPLETE');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high),{refusal:'我无法评价这段录音。'}))})).errors[0].code,'PROVIDER_REFUSAL');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatRaw('这不是 JSON'))})).errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatRaw(undefined))})).errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn({model:'test-model',choices:[]})})).errors[0].code,'INVALID_MODEL_OUTPUT');
});

test('content 为分段数组时同样解析，且拒绝把录音原文写进错误消息',async()=>{
  const payload=cannedAi(high);
  const rec=recorder();
  const split={model:'test-model',choices:[{finish_reason:'stop',message:{content:[{type:'text',text:JSON.stringify(payload).slice(0,40)},{type:'text',text:JSON.stringify(payload).slice(40)}]}}]};
  const out=await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(split)});
  assert.equal(out.errors.length,0);
  assert.equal(out.practiceScore,82);
  const bad=await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer({...cannedAi(high),evidence:[{quote:'NOT IN TRANSCRIPT',observation:'x',dimension:'language'}]}))});
  assert.equal(bad.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.ok(!bad.errors[0].message.includes(high.transcript.slice(0,20)),'错误消息不回显转写原文。');
});

test('空转写、缺 Key 与不支持 fetch 的环境都不发起外部调用',async()=>{
  const emptyRec=recorder();
  const empty=await scoreWithBailian({...high,transcript:'   '},{...OPT,fetchImpl:emptyRec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(emptyRec.calls.length,0);
  assert.equal(empty.errors[0].code,'EMPTY_TRANSCRIPT');
  assert.equal(empty.mode,'ai');
  assert.equal(empty.practiceScore,null);

  const noKey=recorder();
  assert.equal((await scoreWithBailian(high,{...OPT,apiKey:'',fetchImpl:noKey.never})).errors[0].code,'API_KEY_MISSING');
  assert.equal(noKey.calls.length,0);

  const placeholder=recorder();
  const cfg=await scoreWithBailian(high,{...OPT,baseUrl:`https://${WORKSPACE_ID_PLACEHOLDER}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,fetchImpl:placeholder.never});
  assert.equal(cfg.errors[0].code,'PROVIDER_CONFIG_ERROR');
  assert.equal(placeholder.calls.length,0);

  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:null})).errors[0].code,'FETCH_UNAVAILABLE');
});

test('思考模式默认关闭，显式打开时随请求下发 enable_thinking',async()=>{
  const rec=recorder();
  await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(rec.calls[0].body.enable_thinking,false);
  await scoreWithBailian(high,{...OPT,enableThinking:true,fetchImpl:rec.fn(chatAnswer(cannedAi(high)))});
  assert.equal(rec.calls[1].body.enable_thinking,true);
  // 请求带 AbortController signal，超时会转成 PROVIDER_TIMEOUT。
  assert.ok(rec.calls[1].init.signal);
  assert.equal(rec.calls[1].init.signal.aborted,false);
});

test('请求体体积受控：长转写不会被复制进多处字段',async()=>{
  const rec=recorder();
  await scoreWithBailian({...high,transcript:'a'.repeat(20000)},{...OPT,fetchImpl:rec.fn(chatAnswer(cannedAi({...high,transcript:'a'.repeat(20000)})))});
  const body=rec.calls[0].init.body;
  const occurrences=body.split('a'.repeat(20000)).length-1;
  assert.equal(occurrences,1,'转写文本在一次请求里只应出现一份。');
});
