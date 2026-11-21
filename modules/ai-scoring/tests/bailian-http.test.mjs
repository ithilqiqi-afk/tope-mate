/* 百炼通路在 HTTP 层的行为（离线模拟，零真实调用、零真实密钥）。
   重点验证：外部接口 POST /api/evaluate 与 GET /health 未变，
   Schema 1.4.0 信封字段完整，错误码映射成正确的 HTTP 状态，
   以及 OpenAI 密钥绝不被发给阿里云、响应里不出现密钥或业务空间地址。 */
import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {createScoringServer,resolveProvider,PROVIDERS} from '../src/http-server.mjs';
import {blankResult} from '../src/contract.mjs';
import {getPracticeScoreConfig} from '../src/practice-score.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high');
const BEIJING_BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const BEIJING_URL=`${BEIJING_BASE}/chat/completions`;
const BAILIAN_KEY='FAKE_BAILIAN_KEY_for_offline_tests';
const OPENAI_KEY='FAKE_OPENAI_KEY_that_must_stay_unused';

const modelDimensions=req=>getPracticeScoreConfig(req).assessedDimensions.filter(x=>x!=='timeManagement');
const cannedAi=req=>{
  const base=blankResult(req,'ai');
  const scores={...base.scores};
  for(const dim of modelDimensions(req)) scores[dim]=80;
  const quote=req.transcript.slice(0,Math.min(24,req.transcript.length));
  return {...base,mode:'ai',practiceScore:null,scoreStatus:'pending',scorePolicy:null,scoreCoverage:null,
    overall:{...base.overall,score:null,label:'not_scored'},scores,
    dimensionFeedback:modelDimensions(req).map(d=>({dimension:d,rationale:`${d} 的练习表现判断有文本依据。`,evidenceQuotes:[quote]})),
    evidence:[{quote,observation:'引用学生原文作为评价依据',dimension:'relevance'}],errors:[]};
};
const chatAnswer=payload=>({model:'qwen3.8-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]});

function spyFetch(response,{status=200}={}){
  const calls=[];
  const fn=async(url,init)=>{calls.push({url,init});return {ok:status>=200&&status<300,status,json:async()=>response};};
  return {calls,fn};
}

async function withServer(options,fn){
  // 本文件把 chat 通路钉死（responses 通路见 tests/bailian-responses.test.mjs），
  // 这样即使仓库默认接口切到 responses，这里对 /chat/completions 报文的断言依然成立。
  const server=createScoringServer({bailianTransport:'chat',...options});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await fn(base);}finally{server.close();await once(server,'close');}
}
const post=(base,body)=>fetch(`${base}/api/evaluate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('SCORING_PROVIDER 只接受 openai 与 bailian',()=>{
  assert.deepEqual([...PROVIDERS],['openai','bailian']);
  assert.equal(resolveProvider('Bailian'),'bailian');
  assert.equal(resolveProvider(undefined),'openai');
  assert.throws(()=>resolveProvider('dashscope'),/Unsupported SCORING_PROVIDER/);
  assert.throws(()=>createScoringServer({mode:'ai',provider:'zhipu'}),/Unsupported SCORING_PROVIDER/);
});

test('百炼通路的 GET /health 只报告是否配置密钥，不泄露密钥与业务空间地址',async()=>{
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE},async base=>{
    const res=await fetch(`${base}/health`);
    const text=await res.text();
    assert.equal(res.status,200);
    const body=JSON.parse(text);
    assert.equal(body.success,true);
    assert.equal(body.data.mode,'ai');
    assert.equal(body.data.provider,'bailian');
    assert.equal(body.data.model,'qwen3.8-flash');
    assert.equal(body.data.aiKeyConfigured,true);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.ok(!text.includes(BAILIAN_KEY));
    assert.ok(!text.includes('llm-placeholder'));
  });
  await withServer({mode:'ai',provider:'bailian',bailianBaseUrl:BEIJING_BASE,bailianApiKey:''},async base=>{
    const body=await (await fetch(`${base}/health`)).json();
    assert.equal(body.data.aiKeyConfigured,false,'无 Key 时健康检查照常可用。');
  });
});

test('POST /api/evaluate 经百炼返回完整 Schema 1.4.0 报告，meta 原样回传 questionId',async()=>{
  const spy=spyFetch(chatAnswer(cannedAi(high)));
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const res=await post(base,{...high,questionId:'c-speech-001'});
    const text=await res.text();
    assert.equal(res.status,200);
    const body=JSON.parse(text);
    assert.equal(body.success,true);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.mode,'ai');
    assert.equal(body.data.stage,'speech');
    assert.equal(Number.isInteger(body.data.practiceScore),true);
    assert.equal(body.data.officialAssessment.level,null);
    assert.equal(body.meta.questionId,'c-speech-001');
    assert.equal(body.meta.demoOnly,false);
    assert.equal(spy.calls.length,1);
    assert.equal(spy.calls[0].url,BEIJING_URL);
    assert.equal(spy.calls[0].init.headers.Authorization,`Bearer ${BAILIAN_KEY}`);
    assert.ok(!text.includes(BAILIAN_KEY),'响应里绝不出现密钥。');
  });
});

test('OpenAI 密钥不会被当作百炼密钥使用：缺百炼 Key 直接 503 且不出网',async()=>{
  const spy=spyFetch(chatAnswer(cannedAi(high)));
  await withServer({mode:'ai',provider:'bailian',apiKey:OPENAI_KEY,bailianApiKey:'',bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,503);
    const body=await res.json();
    assert.equal(body.success,false);
    assert.equal(body.error.code,'API_KEY_MISSING');
    assert.equal(body.error.retryable,false);
    assert.equal(spy.calls.length,0);
  });
});

test('百炼地址没填好时返回可诊断的 503 PROVIDER_CONFIG_ERROR',async()=>{
  const spy=spyFetch(chatAnswer(cannedAi(high)));
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',fetchImpl:spy.fn},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,503);
    const body=await res.json();
    assert.equal(body.error.code,'PROVIDER_CONFIG_ERROR');
    assert.match(body.error.message,/WorkspaceId/);
    assert.equal(spy.calls.length,0);
  });
});

test('鉴权失败、模型不可用与供应商故障映射为约定的 HTTP 状态',async()=>{
  const table=[
    [401,503,'PROVIDER_AUTH_ERROR'],
    [403,503,'PROVIDER_AUTH_ERROR'],
    [404,502,'PROVIDER_MODEL_UNAVAILABLE'],
    [429,502,'PROVIDER_HTTP_ERROR'],
    [500,502,'PROVIDER_HTTP_ERROR']
  ];
  for(const [providerStatus,expectedHttp,expectedCode] of table){
    const spy=spyFetch({}, {status:providerStatus});
    await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
      const res=await post(base,high);
      assert.equal(res.status,expectedHttp,`供应商 HTTP ${providerStatus}`);
      const body=await res.json();
      assert.equal(body.success,false);
      assert.equal(body.error.code,expectedCode);
      assert.ok(!body.error.message.includes(BAILIAN_KEY));
    });
  }
});

test('空转写优先于密钥检查：422 EMPTY_TRANSCRIPT，且不调用模型',async()=>{
  const spy=spyFetch(chatAnswer(cannedAi(high)));
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const res=await post(base,{...high,transcript:'   '});
    assert.equal(res.status,422);
    assert.equal((await res.json()).error.code,'EMPTY_TRANSCRIPT');
    assert.equal(spy.calls.length,0);
  });
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:'',bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const res=await post(base,{...high,transcript:''});
    assert.equal(res.status,422,'空转写不该被报成缺密钥。');
  });
});

test('provider=bailian 不影响离线启发式模式：无 Key 也能拿到不伪造练习分的报告',async()=>{
  await withServer({mode:'heuristic',provider:'bailian',bailianApiKey:'',bailianBaseUrl:''},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.success,true);
    assert.equal(body.data.mode,'heuristic');
    assert.equal(body.data.practiceScore,null);
    assert.equal(body.data.officialAssessment.level,null);
  });
});

test('模型返回不受信任的分数时百炼通路同样拒绝，并给出 502',async()=>{
  const spy=spyFetch(chatAnswer({...cannedAi(high),practiceScore:99}));
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,502);
    const body=await res.json();
    assert.equal(body.error.code,'INVALID_MODEL_OUTPUT');
    assert.equal(body.data,undefined,'失败信封不携带任何分数。');
  });
});

test('百炼通路的 CORS 与请求体上限与 OpenAI 通路一致',async()=>{
  const spy=spyFetch(chatAnswer(cannedAi(high)));
  await withServer({mode:'ai',provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const preflight=await fetch(`${base}/api/evaluate`,{method:'OPTIONS',headers:{Origin:'http://localhost:5173'}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:5173');
    const tooBig=await post(base,{...high,transcript:'a'.repeat(200000)});
    assert.equal(tooBig.status,413);
    assert.equal((await tooBig.json()).error.code,'PAYLOAD_TOO_LARGE');
    assert.equal(spy.calls.length,0);
    const foreign=await fetch(`${base}/api/evaluate`,{method:'OPTIONS',headers:{Origin:'https://evil.example.com'}});
    assert.equal(foreign.status,403);
  });
});
