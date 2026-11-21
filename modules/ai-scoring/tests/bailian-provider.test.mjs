import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {scoreWithOpenAI,SCORING_PROVIDERS,resolveTimeoutMs} from '../src/provider.mjs';
import {blankResult} from '../src/contract.mjs';
import {getPracticeScoreConfig} from '../src/practice-score.mjs';
import {createScoringServer} from '../src/http-server.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high');
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
const wrap=payload=>({status:'completed',model:'qwen3.8-flash',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});
const captureFetch=(answer,seen)=>async(url,init)=>{seen.url=url;seen.init=init;seen.sent=JSON.parse(init.body);return {ok:true,status:200,json:async()=>answer};};
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

test('Bailian request targets Beijing compatible-mode responses endpoint with nested json_schema format',async()=>{
  const seen={};
  const out=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:captureFetch(wrap(cannedAi(high)),seen)});
  assert.equal(seen.url,'https://dashscope.aliyuncs.com/compatible-mode/v1/responses');
  assert.equal(seen.init.headers.Authorization,'Bearer TEST_KEY');
  assert.equal(seen.sent.model,'qwen3.8-flash');
  assert.equal(seen.sent.store,false);
  assert.ok(seen.sent.instructions.length>0);
  assert.equal(typeof seen.sent.input,'string');
  assert.equal(seen.sent.text.format.type,'json_schema');
  assert.equal(seen.sent.text.format.name,undefined);
  assert.equal(seen.sent.text.format.json_schema.name,'tope_practice_feedback');
  assert.equal(seen.sent.text.format.json_schema.strict,true);
  assert.deepEqual(seen.sent.text.format.json_schema.schema,AI_SCHEMA);
  assert.ok(seen.sent.max_output_tokens>3600);
  assert.deepEqual(seen.sent.reasoning,{effort:'low'});
  assert.equal(out.errors.length,0);
  assert.equal(out.mode,'ai');
  assert.equal(Number.isInteger(out.practiceScore),true);
  assert.equal(out.officialAssessment.level,null);
  assert.equal(out.scorePolicy.modelId,'qwen3.8-flash');
});

test('OpenAI path is unchanged: flat json_schema format, original endpoint, model and token cap',async()=>{
  const seen={};
  await scoreWithOpenAI(high,{apiKey:'TEST_KEY',fetchImpl:captureFetch(wrap(cannedAi(high)),seen)});
  assert.equal(seen.url,'https://api.openai.com/v1/responses');
  assert.equal(seen.sent.model,'gpt-4o-mini');
  assert.equal(seen.sent.text.format.type,'json_schema');
  assert.equal(seen.sent.text.format.name,'tope_practice_feedback');
  assert.equal(seen.sent.text.format.strict,true);
  assert.deepEqual(seen.sent.text.format.schema,AI_SCHEMA);
  assert.equal(seen.sent.text.format.json_schema,undefined);
  assert.equal(seen.sent.max_output_tokens,3600);
  assert.equal(seen.sent.reasoning,undefined);
});

test('BAILIAN_MODEL and BAILIAN_BASE_URL env vars override defaults; trailing slash is normalized',async()=>{
  await withEnv({BAILIAN_MODEL:'qwen3.8-max',BAILIAN_BASE_URL:'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/'},async()=>{
    const seen={};
    await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:captureFetch(wrap(cannedAi(high)),seen)});
    assert.equal(seen.url,'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses');
    assert.equal(seen.sent.model,'qwen3.8-max');
  });
});

test('Bailian reads DASHSCOPE_API_KEY and SCORING_PROVIDER from environment without exposing the key',async()=>{
  await withEnv({SCORING_PROVIDER:'bailian',DASHSCOPE_API_KEY:'FAKE_ENV_KEY_FOR_TEST'},async()=>{
    const seen={};
    const out=await scoreWithOpenAI(high,{fetchImpl:captureFetch(wrap(cannedAi(high)),seen)});
    assert.equal(seen.url,'https://dashscope.aliyuncs.com/compatible-mode/v1/responses');
    assert.equal(seen.init.headers.Authorization,'Bearer FAKE_ENV_KEY_FOR_TEST');
    assert.equal(out.errors.length,0);
    assert.ok(!JSON.stringify(out).includes('FAKE_ENV_KEY_FOR_TEST'));
  });
});

test('Bailian without key returns API_KEY_MISSING naming DASHSCOPE_API_KEY and makes no network call',async()=>{
  await withEnv({DASHSCOPE_API_KEY:undefined},async()=>{
    const out=await scoreWithOpenAI(high,{provider:'bailian',fetchImpl:async()=>{throw new Error('must not be called');}});
    assert.equal(out.errors[0].code,'API_KEY_MISSING');
    assert.match(out.errors[0].message,/DASHSCOPE_API_KEY/);
    assert.equal(out.practiceScore,null);
  });
});

test('Bailian response with reasoning items is parsed via message output_text and evidence stays verbatim',async()=>{
  const body={status:'completed',model:'qwen3.8-flash-2026-11-01',output:[
    {type:'reasoning',summary:[{type:'summary_text',text:'internal thinking'}]},
    {type:'message',content:[{type:'output_text',text:JSON.stringify(cannedAi(high))}]}
  ]};
  const out=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:async()=>({ok:true,status:200,json:async()=>body})});
  assert.equal(out.errors.length,0);
  assert.equal(out.scorePolicy.modelId,'qwen3.8-flash-2026-11-01');
  for(const e of out.evidence) assert.ok(high.transcript.includes(e.quote));
  assert.equal(out.officialAssessment.level,null);
});

test('Bailian incomplete output and invented quotes fail closed without scores',async()=>{
  const incomplete=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'incomplete',output:[]})})});
  assert.equal(incomplete.errors[0].code,'PROVIDER_INCOMPLETE');
  assert.equal(incomplete.practiceScore,null);
  const bad=cannedAi(high,{evidence:[{quote:'NEVER SAID THIS',observation:'x',dimension:'language'}]});
  const invalid=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:async()=>({ok:true,status:200,json:async()=>wrap(bad)})});
  assert.equal(invalid.errors[0].code,'INVALID_MODEL_OUTPUT');
  assert.equal(invalid.practiceScore,null);
});

test('Unsupported provider is rejected; supported list stays openai and bailian',async()=>{
  assert.deepEqual(SCORING_PROVIDERS,['openai','bailian']);
  await assert.rejects(()=>scoreWithOpenAI(high,{provider:'unknown',apiKey:'X'}),/Unsupported SCORING_PROVIDER/);
  assert.throws(()=>createScoringServer({mode:'ai',provider:'unknown'}),/Unsupported SCORING_PROVIDER/);
});

test('HTTP server in bailian mode: 503 without key, 422 empty-transcript priority, 200 full report with fake fetch',async()=>{
  await withEnv({DASHSCOPE_API_KEY:undefined},async()=>{
    await withServer({mode:'ai',provider:'bailian',apiKey:'',fetchImpl:async()=>{throw new Error('must not be called');}},async base=>{
      const noKey=await post(base,high);
      assert.equal(noKey.status,503);
      assert.equal((await noKey.json()).error.code,'API_KEY_MISSING');
      const empty=await post(base,{...high,transcript:'   '});
      assert.equal(empty.status,422);
      assert.equal((await empty.json()).error.code,'EMPTY_TRANSCRIPT');
    });
  });
  const seen={};
  await withServer({mode:'ai',provider:'bailian',apiKey:'TEST_KEY',fetchImpl:captureFetch(wrap(cannedAi(high)),seen)},async base=>{
    const res=await post(base,{...high,questionId:'q-bailian-1'});
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.success,true);
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.officialAssessment.level,null);
    assert.equal(Number.isInteger(body.data.practiceScore),true);
    assert.deepEqual(body.meta,{questionId:'q-bailian-1',demoOnly:false});
    assert.equal(seen.url,'https://dashscope.aliyuncs.com/compatible-mode/v1/responses');
    assert.equal(seen.sent.input.includes('q-bailian-1'),false);
  });
});

test('HTTP server default provider remains openai and health shape is unchanged',async()=>{
  await withServer({mode:'heuristic',apiKey:''},async base=>{
    const body=await (await fetch(`${base}/health`)).json();
    assert.deepEqual(Object.keys(body.data).sort(),['aiKeyConfigured','mode','moduleVersion','schemaVersion','status']);
    assert.equal(body.data.status,'ok');
  });
});

test('Default timeouts: bailian 120s, openai stays 45s; SCORING_TIMEOUT_MS overrides with clamping',async()=>{
  await withEnv({SCORING_TIMEOUT_MS:undefined},async()=>{
    assert.equal(resolveTimeoutMs('bailian'),120000);
    assert.equal(resolveTimeoutMs('openai'),45000);
    assert.equal(resolveTimeoutMs('bailian',60000),60000);
  });
  await withEnv({SCORING_TIMEOUT_MS:'90000'},async()=>{
    assert.equal(resolveTimeoutMs('bailian'),90000);
    assert.equal(resolveTimeoutMs('bailian',60000),60000);
  });
  await withEnv({SCORING_TIMEOUT_MS:'500'},async()=>assert.equal(resolveTimeoutMs('bailian'),1000));
  await withEnv({SCORING_TIMEOUT_MS:'999999'},async()=>assert.equal(resolveTimeoutMs('bailian'),120000));
  await withEnv({SCORING_TIMEOUT_MS:'not-a-number'},async()=>assert.equal(resolveTimeoutMs('bailian'),120000));
});

const hangFetch=seen=>(url,init)=>{
  seen.calls=(seen.calls||0)+1;
  return new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
  });
};

test('Bailian timeout aborts after the configured delay with exactly one model call and no retry',async()=>{
  await withEnv({SCORING_TIMEOUT_MS:undefined},async()=>{
    const seen={};
    const start=Date.now();
    const out=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',timeoutMs:1000,fetchImpl:hangFetch(seen)});
    const elapsed=Date.now()-start;
    assert.equal(out.errors[0].code,'PROVIDER_TIMEOUT');
    assert.equal(out.practiceScore,null);
    assert.equal(seen.calls,1);
    assert.ok(elapsed>=950 && elapsed<5000,`elapsed ${elapsed}ms`);
  });
});

test('SCORING_TIMEOUT_MS reaches the HTTP layer: bailian 504 after env-configured delay, single call',async()=>{
  await withEnv({SCORING_TIMEOUT_MS:'1000'},async()=>{
    const seen={};
    await withServer({mode:'ai',provider:'bailian',apiKey:'TEST_KEY',fetchImpl:hangFetch(seen)},async base=>{
      const start=Date.now();
      const res=await post(base,high);
      const elapsed=Date.now()-start;
      assert.equal(res.status,504);
      assert.equal((await res.json()).error.code,'PROVIDER_TIMEOUT');
      assert.equal(seen.calls,1);
      assert.ok(elapsed>=950 && elapsed<5000,`elapsed ${elapsed}ms`);
    });
  });
});

test('No automatic retry on provider HTTP errors: exactly one model call per request',async()=>{
  for(const provider of ['openai','bailian']){
    let calls=0;
    const out=await scoreWithOpenAI(high,{provider,apiKey:'TEST_KEY',fetchImpl:async()=>{calls++;return {ok:false,status:500,json:async()=>({})};}});
    assert.equal(out.errors[0].code,'PROVIDER_HTTP_ERROR');
    assert.equal(out.practiceScore,null);
    assert.equal(calls,1);
  }
});

test('Scored timeManagement is never listed as unassessed; without target duration it stays unassessed',async()=>{
  const seen={};
  const out=await scoreWithOpenAI(high,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:captureFetch(wrap(cannedAi(high)),seen)});
  assert.equal(out.errors.length,0);
  assert.equal(Number.isInteger(out.scores.timeManagement),true);
  assert.ok(out.scoreCoverage.assessedDimensions.includes('timeManagement'));
  assert.equal(out.unassessed.includes('timeManagement'),false);
  assert.ok(out.unassessed.includes('pronunciation'));
  const {targetDurationSeconds,...noTarget}=high;
  const raw=cannedAi(noTarget);
  raw.scores.timeManagement=null;
  raw.dimensionFeedback=raw.dimensionFeedback.filter(x=>x.dimension!=='timeManagement');
  const out2=await scoreWithOpenAI(noTarget,{provider:'bailian',apiKey:'TEST_KEY',fetchImpl:async()=>({ok:true,status:200,json:async()=>wrap(raw)})});
  assert.equal(out2.errors.length,0);
  assert.equal(out2.scores.timeManagement,null);
  assert.ok(out2.unassessed.includes('timeManagement'));
});