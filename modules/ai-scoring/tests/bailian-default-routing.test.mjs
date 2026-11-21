/* A 侧补充覆盖：合并 PR #4 后，HTTP 层的默认百炼通路必须落到成员 B 真实调用实测通过的
   provider.mjs 报文（嵌套 json_schema + 16384 token + effort=low），只有显式
   BAILIAN_SCORING_TRANSPORT=chat 才走 bailian-provider.mjs 的非默认备用实现。
   这里只钉传输层选路、思考参数作用域与错误映射，不重复 B 的评分算法断言，也不修改 B 的任何文件。
   全部使用伪造密钥与伪造主机，绝不发出真实请求。 */
import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {createScoringServer} from '../src/http-server.mjs';
import {blankResult} from '../src/contract.mjs';
import {getPracticeScoreConfig} from '../src/practice-score.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';
import {BAILIAN_SCHEMA_NAME,BAILIAN_MAX_OUTPUT_TOKENS,DEFAULT_BAILIAN_MODEL} from '../src/bailian-provider.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high');
const BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const FAKE_KEY='BAILIAN_FAKE_KEY_do_not_use';

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
const responsesAnswer=payload=>({status:'completed',model:DEFAULT_BAILIAN_MODEL,
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});
const chatAnswer=payload=>({model:DEFAULT_BAILIAN_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]});

function recorder(answer,{status=200}={}){
  const calls=[];
  const fn=async(url,init)=>{
    calls.push({url,init,body:JSON.parse(init.body)});
    return {ok:status>=200&&status<300,status,json:async()=>answer};
  };
  return {calls,fn};
}
const hangFetch=seen=>(url,init)=>{
  seen.calls=(seen.calls||0)+1;
  return new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
  });
};
async function withEnv(patch,fn){
  const saved={};
  for(const k of Object.keys(patch)){saved[k]=process.env[k];if(patch[k]===undefined)delete process.env[k];else process.env[k]=patch[k];}
  try{await fn();}finally{for(const k of Object.keys(saved)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
}
async function withServer(options,fn){
  const server=createScoringServer(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await fn(base);}finally{server.close();await once(server,'close');}
}
const post=(base,body)=>fetch(`${base}/api/evaluate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const opts=extra=>({mode:'ai',provider:'bailian',bailianApiKey:FAKE_KEY,bailianBaseUrl:BASE,...extra});

test('默认百炼评分在 HTTP 层用 B 的 responses 报文：嵌套 json_schema、16384 token、effort=low',async()=>{
  const rec=recorder(responsesAnswer(cannedAi(high)));
  await withServer(opts({fetchImpl:rec.fn}),async base=>{
    const res=await post(base,{...high,questionId:'c-speech-001'});
    const text=await res.text();
    const body=JSON.parse(text);
    assert.equal(res.status,200);
    assert.equal(body.success,true);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.meta.questionId,'c-speech-001');
    assert.equal(body.data.scores.relevance,80);
    assert.equal(body.data.officialAssessment.level,null);
    assert.ok(!text.includes(FAKE_KEY));
    assert.equal(rec.calls.length,1,'一次评分请求只允许一次模型调用，不自动重试。');
    assert.equal(rec.calls[0].url,`${BASE}/responses`);
    assert.equal(rec.calls[0].init.headers.Authorization,`Bearer ${FAKE_KEY}`);
    const sent=rec.calls[0].body;
    assert.equal(sent.model,DEFAULT_BAILIAN_MODEL);
    assert.equal(sent.store,false);
    assert.equal(sent.text.format.type,'json_schema');
    assert.equal(sent.text.format.name,undefined,'默认通路必须是 B 的嵌套写法，不是备用实现的扁平写法。');
    assert.equal(sent.text.format.json_schema.name,BAILIAN_SCHEMA_NAME);
    assert.equal(sent.text.format.json_schema.strict,true);
    assert.deepEqual(sent.text.format.json_schema.schema,AI_SCHEMA);
    assert.equal(sent.max_output_tokens,16384);
    assert.ok(sent.max_output_tokens>BAILIAN_MAX_OUTPUT_TOKENS,'思维链计入上限，默认通路不能沿用备用实现的 3600。');
    assert.deepEqual(sent.reasoning,{effort:'low'});
    for(const forbidden of ['enable_thinking','response_format','messages','max_tokens','input_audio','audio'])
      assert.ok(!(forbidden in sent),`默认 responses 报文不应出现 ${forbidden}`);
  });
});

test('显式 chat 才走 A 的备用报文：扁平 json_schema、不发 token 上限、enable_thinking=false',async()=>{
  const rec=recorder(chatAnswer(cannedAi(high)));
  await withServer(opts({bailianTransport:'chat',fetchImpl:rec.fn}),async base=>{
    const res=await post(base,high);
    const body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.scores.relevance,80);
    assert.equal(rec.calls.length,1);
    assert.equal(rec.calls[0].url,`${BASE}/chat/completions`);
    const sent=rec.calls[0].body;
    assert.equal(sent.response_format.type,'json_schema');
    assert.equal(sent.response_format.json_schema.name,BAILIAN_SCHEMA_NAME);
    assert.equal(sent.response_format.json_schema.strict,true);
    assert.deepEqual(sent.response_format.json_schema.schema,AI_SCHEMA);
    assert.equal(sent.text,undefined);
    assert.equal(sent.enable_thinking,false);
    assert.equal(sent.messages[0].role,'system');
    assert.equal(sent.messages[1].role,'user');
    for(const forbidden of ['max_tokens','max_output_tokens','reasoning','instructions','store'])
      assert.ok(!(forbidden in sent),`备用 chat 报文不应出现 ${forbidden}`);
  });
});

test('思考参数只作用于备用通路：默认 responses 始终 effort=low，chat 才读 enable_thinking',async()=>{
  await withEnv({BAILIAN_SCORING_REASONING_EFFORT:'xhigh',BAILIAN_ENABLE_THINKING:'true'},async()=>{
    const plain=recorder(responsesAnswer(cannedAi(high)));
    await withServer(opts({fetchImpl:plain.fn}),async base=>{
      assert.equal((await post(base,high)).status,200);
      assert.deepEqual(plain.calls[0].body.reasoning,{effort:'low'},'默认通路的思考强度由 B 的实现钉住，环境变量不得改写。');
      assert.ok(!('enable_thinking' in plain.calls[0].body));
    });
    const chat=recorder(chatAnswer(cannedAi(high)));
    await withServer(opts({bailianTransport:'chat',fetchImpl:chat.fn}),async base=>{
      assert.equal((await post(base,high)).status,200);
      assert.equal(chat.calls[0].body.enable_thinking,true);
      assert.ok(!('reasoning' in chat.calls[0].body),'reasoning.effort 只属于备用 responses 分支。');
    });
  });
});

test('默认 responses 沿用 B 的错误映射：401/403/404/500 都是 502 PROVIDER_HTTP_ERROR，备用 chat 才细分鉴权与模型',async()=>{
  for(const status of [401,403,404,500]){
    const rec=recorder({},{status});
    await withServer(opts({fetchImpl:rec.fn}),async base=>{
      const res=await post(base,high);
      const body=await res.json();
      assert.equal(res.status,502,`HTTP ${status}`);
      assert.equal(body.error.code,'PROVIDER_HTTP_ERROR',`HTTP ${status}`);
      assert.equal(body.error.retryable,true);
      assert.equal(body.data,undefined);
      assert.equal(rec.calls.length,1,'失败也不自动重试。');
      assert.ok(!JSON.stringify(body).includes(FAKE_KEY));
    });
  }
  for(const [status,http,code] of [[401,503,'PROVIDER_AUTH_ERROR'],[403,503,'PROVIDER_AUTH_ERROR'],[404,502,'PROVIDER_MODEL_UNAVAILABLE']]){
    const rec=recorder({},{status});
    await withServer(opts({bailianTransport:'chat',fetchImpl:rec.fn}),async base=>{
      const res=await post(base,high);
      const body=await res.json();
      assert.equal(res.status,http,`chat HTTP ${status}`);
      assert.equal(body.error.code,code,`chat HTTP ${status}`);
      assert.equal(body.error.retryable,false);
      assert.equal(rec.calls.length,1);
    });
  }
});

test('SCORING_TIMEOUT_MS 在默认通路生效并被钳制：504 单次调用，上限仍是 120 秒',async()=>{
  await withEnv({SCORING_TIMEOUT_MS:'1000'},async()=>{
    const seen={};
    await withServer(opts({fetchImpl:hangFetch(seen)}),async base=>{
      const health=await (await fetch(`${base}/health`)).json();
      assert.equal(health.data.timeoutMs,1000);
      assert.equal(health.data.transport,'responses');
      const start=Date.now();
      const res=await post(base,high);
      const elapsed=Date.now()-start;
      const body=await res.json();
      assert.equal(res.status,504);
      assert.equal(body.error.code,'PROVIDER_TIMEOUT');
      assert.equal(body.error.retryable,true);
      assert.equal(seen.calls,1);
      assert.ok(elapsed>=950&&elapsed<5000,`elapsed ${elapsed}ms`);
    });
  });
  await withEnv({SCORING_TIMEOUT_MS:'999999'},async()=>{
    await withServer(opts({fetchImpl:async()=>{throw new Error('离线测试不允许发出真实请求。');}}),async base=>{
      const health=await (await fetch(`${base}/health`)).json();
      assert.equal(health.data.timeoutMs,120000,'服务端超时必须保持 120 秒上限，且小于前端的 150 秒。');
    });
  });
  await withEnv({SCORING_TIMEOUT_MS:undefined},async()=>{
    await withServer(opts({fetchImpl:async()=>{throw new Error('离线测试不允许发出真实请求。');}}),async base=>{
      const health=await (await fetch(`${base}/health`)).json();
      assert.equal(health.data.timeoutMs,120000);
    });
  });
});