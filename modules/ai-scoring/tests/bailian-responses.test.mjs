/* 百炼 Responses 通路（成员 B 2026-11-21 真实调用实测通过的接口）的离线模拟测试。
   全程零真实密钥、零真实请求、零付费调用：伪造 Key + 伪造响应体，重点验证
   ①仓库默认接口已切到 /responses 且报文与 B 的实测形态逐字段一致；
   ②只换传输层：同一份模型输出经 responses / chat / OpenAI 三条通路必须得到完全相同的 1.4.0 报告；
   ③原文证据校验与无法评估维度处理没有因为换接口而放松；
   ④无 Key、占位符地址、鉴权失败、模型不可用、超时断网、输出截断都在出网前后如实报错，不产生分数。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {
  scoreWithBailian,bailianResponsesUrl,bailianUrlFor,resolveBailianTransport,
  DEFAULT_BAILIAN_MODEL,DEFAULT_BAILIAN_TRANSPORT,DEFAULT_BAILIAN_BASE_URL,BAILIAN_SCHEMA_NAME,
  BAILIAN_TRANSPORTS,BAILIAN_MAX_OUTPUT_TOKENS,WORKSPACE_ID_PLACEHOLDER
} from '../src/bailian-provider.mjs';
import {scoreWithOpenAI,SYSTEM_PROMPT} from '../src/provider.mjs';
import {createScoringServer} from '../src/http-server.mjs';
import {blankResult} from '../src/contract.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';
import {getPracticeScoreConfig} from '../src/practice-score.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high'),discuss=fixture('b_discussion_no_turns');
// 主机名与密钥一律伪造；路径形态与官方文档一致。
const DASHSCOPE_BASE='https://dashscope.aliyuncs.com/compatible-mode/v1';
const PLACEHOLDER_BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const RESPONSES_URL=`${PLACEHOLDER_BASE}/responses`;
const FAKE_KEY='BAILIAN_FAKE_KEY_do_not_use';
const OPENAI_KEY='FAKE_OPENAI_KEY_that_must_stay_unused';
const OPT={apiKey:FAKE_KEY,baseUrl:PLACEHOLDER_BASE};

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
/** Responses 非流式响应：模型文本在 output_text（help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses）。 */
const respAnswer=(payload,{model=DEFAULT_BAILIAN_MODEL,status='completed'}={})=>({
  id:'resp-fake-1',object:'response',model,status,output:[
    {type:'message',id:'msg-fake-1',role:'assistant',status:'completed',
     content:[{type:'output_text',text:JSON.stringify(payload),annotations:[]}]}
  ],output_text:JSON.stringify(payload)
});
/** 只给 output[]、不给 output_text 的形态，验证与 provider.mjs 的 getText 同构。 */
const respMessage=text=>({id:'r',model:DEFAULT_BAILIAN_MODEL,status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});

function recorder(){
  const calls=[];
  const fn=(response,{status=200}={})=>async(url,init)=>{
    calls.push({url,init,body:JSON.parse(init.body)});
    return {ok:status>=200&&status<300,status,json:async()=>response};
  };
  const never=async(url,init)=>{calls.push({url,init});throw new Error('离线测试不允许发出真实请求。');};
  return {calls,fn,never};
}
const impl=fn=>async(url,init)=>({ok:true,status:200,json:async()=>fn});

async function withServer(options,fn){
  const server=createScoringServer(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await fn(base);}finally{server.close();await once(server,'close');}
}
const post=(base,body)=>fetch(`${base}/api/evaluate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('接口名解析：默认 responses、大小写与空格容忍、非法值在构造阶段就抛',()=>{
  assert.deepEqual([...BAILIAN_TRANSPORTS],['responses','chat']);
  assert.equal(DEFAULT_BAILIAN_TRANSPORT,'responses');
  assert.equal(resolveBailianTransport(undefined),'responses');
  assert.equal(resolveBailianTransport('  CHAT '),'chat');
  assert.throws(()=>resolveBailianTransport('completions'),/BAILIAN_SCORING_TRANSPORT/);
  assert.throws(()=>createScoringServer({mode:'ai',provider:'bailian',bailianTransport:'gpt'}),/BAILIAN_SCORING_TRANSPORT/);
});

test('Responses 地址解析：默认地址免业务空间 ID，chat 地址也能换算，占位符与 http 在出网前被拒',()=>{
  assert.equal(DEFAULT_BAILIAN_BASE_URL,'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(bailianResponsesUrl(DEFAULT_BAILIAN_BASE_URL),`${DEFAULT_BAILIAN_BASE_URL}/responses`);
  assert.equal(bailianResponsesUrl(`${PLACEHOLDER_BASE}/`),RESPONSES_URL);
  assert.equal(bailianResponsesUrl(RESPONSES_URL),RESPONSES_URL);
  // 同一份 BAILIAN_BASE_URL 不论填到哪条接口，都只换尾段，不会拼出 /chat/completions/responses。
  assert.equal(bailianResponsesUrl(`${PLACEHOLDER_BASE}/chat/completions`),RESPONSES_URL);
  assert.equal(bailianUrlFor('responses',PLACEHOLDER_BASE),RESPONSES_URL);
  assert.equal(bailianUrlFor('chat',PLACEHOLDER_BASE),`${PLACEHOLDER_BASE}/chat/completions`);
  assert.ok(!bailianResponsesUrl(PLACEHOLDER_BASE).includes(WORKSPACE_ID_PLACEHOLDER));
  assert.throws(()=>bailianResponsesUrl(`https://${WORKSPACE_ID_PLACEHOLDER}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`),/WorkspaceId/);
  assert.throws(()=>bailianResponsesUrl(''),/BAILIAN_BASE_URL/);
  assert.throws(()=>bailianResponsesUrl('http://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),/https/);
});

test('默认报文与成员 B 实测形态一致：/responses + store:false + instructions + 扁平 json_schema',async()=>{
  const rec=recorder();
  await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn(respAnswer(cannedAi(high)))});
  assert.equal(rec.calls.length,1);
  assert.equal(rec.calls[0].url,RESPONSES_URL,'仓库默认接口必须是实测通过的 responses，而不是上一轮的 chat/completions。');
  const body=rec.calls[0].body;
  assert.equal(body.model,DEFAULT_BAILIAN_MODEL);
  assert.equal(body.store,false,'官方默认 store=true 会保存会话；本项目绝不上传可回看的转写原文。');
  assert.equal(body.stream,false);
  assert.equal(body.instructions,SYSTEM_PROMPT,'提示词必须与 OpenAI 通路同源，否则历史比较键不再成立。');
  assert.equal(body.text.format.type,'json_schema');
  assert.equal(body.text.format.name,BAILIAN_SCHEMA_NAME);
  assert.equal(body.text.format.strict,true);
  assert.deepEqual(body.text.format.schema,AI_SCHEMA);
  assert.equal(body.max_output_tokens,BAILIAN_MAX_OUTPUT_TOKENS);
  for(const forbidden of ['max_tokens','response_format','messages','input_audio','audio','tools','previous_response_id','conversation'])
    assert.ok(!(forbidden in body),`responses 报文不应出现 ${forbidden}`);
  assert.equal(rec.calls[0].init.headers.Authorization,`Bearer ${FAKE_KEY}`);
});

test('送给模型的 input 与 OpenAI 通路逐字节相同，questionId 不进模型',async()=>{
  const bailian=recorder(),openai=recorder();
  await scoreWithBailian({...high,questionId:'c-speech-001'},{...OPT,fetchImpl:bailian.fn(respAnswer(cannedAi(high)))});
  await scoreWithOpenAI({...high,questionId:'c-speech-001'},{apiKey:OPENAI_KEY,fetchImpl:openai.fn(respAnswer(cannedAi(high)))});
  assert.equal(bailian.calls[0].body.input,openai.calls[0].body.input);
  const sent=JSON.parse(bailian.calls[0].body.input);
  assert.equal(sent.request.questionId,undefined);
  assert.equal(sent.request.transcript,high.transcript);
  assert.equal(sent.practiceScoreConfig.weightBasis,'product_defined_not_official');
  assert.equal(sent.practiceScoreConfig.weights.relevance,30);
});

test('同一份模型输出经 responses、chat 与 OpenAI 三条通路得到逐字段一致的报告',async()=>{
  const payload=cannedAi(high);
  // 三条通路都用同一个 model 字段，deepEqual 才只比较算法结果，不被 modelId 差异干扰。
  const viaResponses=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respAnswer(payload,{model:'same-model'}))});
  const viaChat=await scoreWithBailian(high,{...OPT,transport:'chat',fetchImpl:impl({model:'same-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})});
  const viaOpenAI=await scoreWithOpenAI(high,{apiKey:OPENAI_KEY,fetchImpl:impl(respAnswer(payload,{model:'same-model'}))});
  assert.deepEqual(viaResponses,viaChat);
  assert.deepEqual(viaResponses,viaOpenAI);
  assert.equal(viaResponses.mode,'ai');
  assert.equal(viaResponses.scores.relevance,80);
  // 分数由后端按打分表算，模型自由生成的总分不被采信。
  assert.equal(typeof viaResponses.practiceScore,'number');
  assert.equal(viaResponses.officialAssessment.level,null);
});

test('解析 output_text 与 output[] 两种形态，refusal 与截断都归入明确错误且不产出分数',async()=>{
  const ok1=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respAnswer(cannedAi(high)))});
  assert.equal(ok1.errors.length,0);
  const ok2=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respMessage(JSON.stringify(cannedAi(high))))});
  assert.deepEqual(ok2,ok1);
  const refused=await scoreWithBailian(high,{...OPT,fetchImpl:impl({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'我无法评价。'}]}]})});
  assert.equal(refused.errors[0].code,'PROVIDER_REFUSAL');
  const incomplete=await scoreWithBailian(high,{...OPT,fetchImpl:impl({...respAnswer(cannedAi(high)),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})});
  assert.equal(incomplete.errors[0].code,'PROVIDER_INCOMPLETE');
  assert.equal(incomplete.practiceScore,null);
  assert.equal(JSON.stringify(incomplete.scores).includes('80'),false,'截断响应不得留下任何维度分。');
  const notJson=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respMessage('这不是 JSON'))});
  assert.equal(notJson.errors[0].code,'INVALID_MODEL_OUTPUT');
  const empty=await scoreWithBailian(high,{...OPT,fetchImpl:impl({status:'completed',output:[]})});
  assert.equal(empty.errors[0].code,'INVALID_MODEL_OUTPUT');
  const notParseable=await scoreWithBailian(high,{...OPT,fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw new Error('boom');}})});
  assert.equal(notParseable.errors[0].code,'INVALID_MODEL_OUTPUT');
});

test('换接口没有放松原文证据校验：编造引文、预测等级与自带总分照样 fail closed',async()=>{
  const agg=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respAnswer(cannedAi(high,{practiceScore:88})))});
  assert.equal(agg.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(agg.practiceScore,null);
  const withLevel=cannedAi(high);
  withLevel.officialAssessment={...withLevel.officialAssessment,level:5};
  const lvl=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respAnswer(withLevel))});
  assert.equal(lvl.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(lvl.officialAssessment.level,null,'被拒绝的报告不得留下等级预测。');
  const invented=await scoreWithBailian(high,{...OPT,fetchImpl:impl(respAnswer(cannedAi(high,{evidence:[{quote:'NEVER SAID THIS',observation:'x',dimension:'language'}]})))});
  assert.equal(invented.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(invented.scores.relevance,null,'校验失败时不采用任何维度分。');
  assert.ok(!JSON.stringify(invented.errors).includes('NEVER SAID THIS'),'错误消息不回显模型原文。');
});

test('B 侧讨论没有真实轮次时互动维度仍不评分',async()=>{
  const ok=await scoreWithBailian(discuss,{...OPT,fetchImpl:impl(respAnswer(cannedAi(discuss)))});
  assert.equal(ok.errors.length,0);
  assert.equal(ok.scores.interaction,null);
  assert.deepEqual(ok.scoreCoverage.notAssessedDimensions,['interaction']);
  const withTurnsScore=cannedAi(discuss);
  withTurnsScore.scores.interaction=75;
  withTurnsScore.dimensionFeedback=[...withTurnsScore.dimensionFeedback,{dimension:'interaction',rationale:'互动表现良好。',evidenceQuotes:[discuss.transcript.slice(0,24)]}];
  const bad=await scoreWithBailian(discuss,{...OPT,fetchImpl:impl(respAnswer(withTurnsScore))});
  assert.equal(bad.errors[0].code,'INVALID_MODEL_OUTPUT');
});

test('鉴权失败、模型不可用与供应商故障映射为明确错误码，且不回显密钥与主机',async()=>{
  for(const [status,expected] of [[401,'PROVIDER_AUTH_ERROR'],[403,'PROVIDER_AUTH_ERROR'],[404,'PROVIDER_MODEL_UNAVAILABLE'],[429,'PROVIDER_HTTP_ERROR'],[500,'PROVIDER_HTTP_ERROR']]){
    const rec=recorder();
    const out=await scoreWithBailian(high,{...OPT,fetchImpl:rec.fn({}, {status})});
    assert.equal(out.errors[0].code,expected,`HTTP ${status}`);
    const dump=JSON.stringify(out.errors);
    assert.ok(!dump.includes(FAKE_KEY));
    assert.ok(!dump.includes('llm-placeholder'),`HTTP ${status} 的错误消息不应带出主机`);
  }
});

test('超时、断网与没有 fetch 的环境各自归入明确错误；无 Key 与坏地址零次出网',async()=>{
  const timeout=async()=>{const e=new Error('aborted');e.name='AbortError';throw e;};
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:timeout})).errors[0].code,'PROVIDER_TIMEOUT');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:async()=>{throw new Error('socket hang up');}})).errors[0].code,'PROVIDER_NETWORK_ERROR');
  assert.equal((await scoreWithBailian(high,{...OPT,fetchImpl:null})).errors[0].code,'FETCH_UNAVAILABLE');
  const noKey=recorder();
  const out=await scoreWithBailian(high,{...OPT,apiKey:'',fetchImpl:noKey.never});
  assert.equal(out.errors[0].code,'API_KEY_MISSING');
  assert.equal(noKey.calls.length,0);
  const badUrl=recorder();
  const cfg=await scoreWithBailian(high,{...OPT,baseUrl:'',fetchImpl:badUrl.never});
  assert.equal(cfg.errors[0].code,'PROVIDER_CONFIG_ERROR');
  assert.equal(badUrl.calls.length,0);
  const badTransport=recorder();
  const tr=await scoreWithBailian(high,{...OPT,transport:'dashscope',fetchImpl:badTransport.never});
  assert.equal(tr.errors[0].code,'PROVIDER_CONFIG_ERROR');
  assert.equal(badTransport.calls.length,0);
});

test('思考强度默认不下发（保持 B 实测的模型默认档位），显式配置才发送 reasoning.effort',async()=>{
  const plain=recorder();
  await scoreWithBailian(high,{...OPT,fetchImpl:plain.fn(respAnswer(cannedAi(high)))});
  assert.equal('reasoning' in plain.calls[0].body,false);
  const tuned=recorder();
  await scoreWithBailian(high,{...OPT,reasoningEffort:'low',fetchImpl:tuned.fn(respAnswer(cannedAi(high)))});
  assert.deepEqual(tuned.calls[0].body.reasoning,{effort:'low'});
});

test('空转写优先于一切：不出网、不鉴权、不调模型',async()=>{
  const rec=recorder();
  const out=await scoreWithBailian({...high,transcript:'   '},{...OPT,fetchImpl:rec.never});
  assert.equal(rec.calls.length,0);
  assert.equal(out.mode,'ai');
  assert.equal(out.practiceScore,null);
});

/* ── HTTP 层：外部接口与信封必须一条不变 ─────────────────────────── */

test('GET /health 如实报告生效的接口与超时，不泄露密钥与主机',async()=>{
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE},async base=>{
    const res=await fetch(`${base}/health`);
    const text=await res.text();
    const body=JSON.parse(text);
    assert.equal(res.status,200);
    assert.equal(body.data.provider,'bailian');
    assert.equal(body.data.transport,'responses','默认必须是实测通过的接口。');
    assert.equal(body.data.model,DEFAULT_BAILIAN_MODEL);
    assert.equal(body.data.timeoutMs,120000,'真实评分实测 59.09 秒，服务端超时不能再是旧的 45 秒。');
    assert.equal(body.data.aiKeyConfigured,true);
    assert.ok(!text.includes(FAKE_KEY));
    assert.ok(!text.includes('llm-placeholder'));
  });
  await withServer({mode:'ai',provider:'bailian',bailianTransport:'chat',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE},async base=>{
    const body=await (await fetch(`${base}/health`)).json();
    assert.equal(body.data.transport,'chat');
  });
  await withServer({mode:'ai',provider:'openai',apiKey:OPENAI_KEY},async base=>{
    const body=await (await fetch(`${base}/health`)).json();
    assert.equal(body.data.transport,null,'openai 通路不声明百炼接口名。');
  });
});

test('POST /api/evaluate 默认走 responses，返回完整 Schema 1.4.0 信封并原样回传 questionId',async()=>{
  const rec=recorder();
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE,fetchImpl:rec.fn(respAnswer(cannedAi(high)))},async base=>{
    const res=await post(base,{...high,questionId:'c-speech-001'});
    const body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.success,true);
    assert.equal(body.meta.questionId,'c-speech-001');
    assert.equal(body.meta.demoOnly,false);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.scores.relevance,80);
    assert.equal(body.data.officialAssessment.level,null);
    assert.equal(rec.calls[0].url,RESPONSES_URL);
    assert.ok(!JSON.stringify(body).includes(FAKE_KEY));
  });
});

test('只有 OpenAI 密钥时 responses 通路照样 503 且零次出网',async()=>{
  const rec=recorder();
  await withServer({mode:'ai',provider:'bailian',apiKey:OPENAI_KEY,bailianApiKey:'',bailianBaseUrl:PLACEHOLDER_BASE,fetchImpl:rec.never},async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,503);
    assert.equal(body.error.code,'API_KEY_MISSING');
    assert.equal(rec.calls.length,0);
    assert.ok(!JSON.stringify(body).includes(OPENAI_KEY));
  });
});

test('{WorkspaceId} 占位符地址在出网前返回 503 PROVIDER_CONFIG_ERROR',async()=>{
  const rec=recorder();
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:`https://${WORKSPACE_ID_PLACEHOLDER}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,fetchImpl:rec.never},async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,503);
    assert.equal(body.error.code,'PROVIDER_CONFIG_ERROR');
    assert.equal(rec.calls.length,0);
  });
});

test('heuristic 模式即使接口配成 responses 也不出网，且不伪造练习分',async()=>{
  const rec=recorder();
  await withServer({mode:'heuristic',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE,fetchImpl:rec.never},async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.data.practiceScore,null);
    assert.equal(rec.calls.length,0);
  });
});

test('模型超时在 HTTP 层是 504，截断是 502，两者都不带 data 字段',async()=>{
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE,
    fetchImpl:async()=>{const e=new Error('aborted');e.name='AbortError';throw e;}},async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,504);
    assert.equal(body.error.code,'PROVIDER_TIMEOUT');
    assert.equal(body.error.retryable,true);
    assert.equal(body.data,undefined);
  });
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:PLACEHOLDER_BASE,
    fetchImpl:impl({...respAnswer(cannedAi(high)),status:'incomplete'})},async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,502);
    assert.equal(body.error.code,'PROVIDER_INCOMPLETE');
    assert.equal(body.data,undefined);
  });
});
