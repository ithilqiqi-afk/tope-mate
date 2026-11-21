import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {createScoringServer,MAX_BODY_BYTES,ALLOWED_ORIGINS} from '../src/http-server.mjs';
import {blankResult,hasInteractionEvidence as contractFn} from '../src/contract.mjs';
import {hasInteractionEvidence as practiceFn,getPracticeScoreConfig} from '../src/practice-score.mjs';

const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high');

async function withServer(options,fn){
  const server=createScoringServer(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await fn(base);}finally{server.close();await once(server,'close');}
}
const post=(base,body,{headers={},raw}={})=>fetch(`${base}/api/evaluate`,{
  method:'POST',headers:{'Content-Type':'application/json',...headers},body:raw!==undefined?raw:JSON.stringify(body)});
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
const wrap=payload=>({status:'completed',model:'test-model',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});
const fakeFetch=answer=>async()=>({ok:true,status:200,json:async()=>answer});

test('GET /health returns success with mode and schema info',async()=>{
  await withServer({mode:'heuristic',apiKey:''},async base=>{
    const res=await fetch(`${base}/health`);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.success,true);
    assert.equal(body.data.status,'ok');
    assert.equal(body.data.mode,'heuristic');
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.meta.demoOnly,false);
    assert.equal(body.data.aiKeyConfigured,false);
  });
});

test('POST /api/evaluate returns a complete v1.4.0 report in data with meta',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    const res=await post(base,{...high,questionId:'c-speech-001'});
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.success,true);
    assert.equal(typeof body.data,'object');
    assert.equal(body.data.schemaVersion,'1.4.0');
    assert.equal(body.data.examType,'C');
    assert.equal(body.data.stage,'speech');
    for(const field of ['scores','peel','peelDetails','scorePolicy','scoreCoverage','rubricBasis','officialAssessment','diagnostics'])
      assert.ok(body.data[field],`missing ${field}`);
    assert.deepEqual(body.meta,{questionId:'c-speech-001',demoOnly:false});
  });
});

test('Malformed JSON returns 400 INVALID_JSON',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    const res=await post(base,null,{raw:'{"examType": "C",'});
    assert.equal(res.status,400);
    const body=await res.json();
    assert.equal(body.success,false);
    assert.equal(body.error.code,'INVALID_JSON');
    assert.equal(typeof body.error.message,'string');
  });
});

test('Oversized request body returns 413 PAYLOAD_TOO_LARGE',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    const res=await post(base,{...high,transcript:'a'.repeat(MAX_BODY_BYTES)});
    assert.equal(res.status,413);
    assert.equal((await res.json()).error.code,'PAYLOAD_TOO_LARGE');
  });
});

test('Empty or whitespace transcript returns 422 EMPTY_TRANSCRIPT without scoring',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    for(const transcript of ['','   ']){
      const res=await post(base,{...high,transcript});
      assert.equal(res.status,422);
      const body=await res.json();
      assert.equal(body.error.code,'EMPTY_TRANSCRIPT');
      assert.equal(body.error.retryable,false);
      assert.equal(body.data,undefined);
    }
  });
});

test('Invalid fields return 422 INVALID_FIELD',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    for(const bad of [{...high,stage:'intro'},{...high,examType:'D'},{...high,durationSeconds:-3},{...high,question:'  '},{...high,targetDurationSeconds:0}]){
      const res=await post(base,bad);
      assert.equal(res.status,422);
      assert.equal((await res.json()).error.code,'INVALID_FIELD');
    }
  });
});

test('AI mode without API key returns 503 API_KEY_MISSING and never fabricates a score',async()=>{
  await withServer({mode:'ai',apiKey:'',fetchImpl:async()=>{throw new Error('must not be called');}},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,503);
    const body=await res.json();
    assert.equal(body.error.code,'API_KEY_MISSING');
    assert.equal(body.data,undefined);
  });
});

test('Empty transcript outranks missing API key: 422 EMPTY_TRANSCRIPT with zero model calls',async()=>{
  for(const transcript of ['','   ']){
    let calls=0;
    const countingFetch=async()=>{calls++;throw new Error('model must not be called');};
    await withServer({mode:'ai',apiKey:'',fetchImpl:countingFetch},async base=>{
      const res=await post(base,{...high,transcript});
      assert.equal(res.status,422);
      const body=await res.json();
      assert.equal(body.success,false);
      assert.equal(body.error.code,'EMPTY_TRANSCRIPT');
      assert.equal(body.data,undefined);
    });
    assert.equal(calls,0);
  }
});

test('questionId is validated, echoed in meta and never sent to the model',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    for(const questionId of ['','x'.repeat(129),42]){
      const res=await post(base,{...high,questionId});
      assert.equal(res.status,422);
      assert.equal((await res.json()).error.code,'INVALID_FIELD');
    }
    const ok=await post(base,{...high,questionId:'q-128'});
    assert.equal((await ok.json()).meta.questionId,'q-128');
    const none=await post(base,high);
    assert.equal((await none.json()).meta.questionId,null);
  });
  let sentInput;
  const captureFetch=async(_url,init)=>{sentInput=JSON.parse(JSON.parse(init.body).input);return {ok:true,status:200,json:async()=>wrap(cannedAi(high))};};
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:captureFetch},async base=>{
    const res=await post(base,{...high,questionId:'tracking-only'});
    assert.equal(res.status,200);
    assert.equal(sentInput.request.questionId,undefined);
    assert.equal(sentInput.request.transcript,high.transcript);
  });
});

test('Examiner-only turns are not peer interaction evidence over HTTP; shared rule is consistent',async()=>{
  assert.equal(contractFn,practiceFn);
  const req={...fixture('b_discussion_no_turns'),assessedSpeaker:'B',speakerTurns:[
    {speaker:'B',text:'I think students need enough rest.'},
    {speaker:'examiner',text:'Can you explain why?'}
  ]};
  assert.equal(contractFn(req),false);
  assert.equal(practiceFn(req),false);
  const emptyPeer={...req,speakerTurns:[{speaker:'B',text:'My view.'},{speaker:'A',text:'   '}]};
  assert.equal(contractFn(emptyPeer),false);
  const realPeer={...req,speakerTurns:[{speaker:'B',text:'My view.'},{speaker:'A',text:'I disagree because part-time jobs teach responsibility.'}]};
  assert.equal(contractFn(realPeer),true);
  await withServer({mode:'heuristic'},async base=>{
    const res=await post(base,req);
    assert.equal(res.status,200);
    const {data}=await res.json();
    assert.equal(data.scores.interaction,null);
    assert.ok(data.unassessed.includes('interaction'));
    assert.ok(data.unassessed.includes('group_interaction_without_speaker_turns'));
  });
});

test('Model output with an official level is rejected with 502 and no score is returned',async()=>{
  const bad=cannedAi(high,{officialAssessment:{...blankResult(high,'ai').officialAssessment,level:5}});
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:fakeFetch(wrap(bad))},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,502);
    const body=await res.json();
    assert.equal(body.error.code,'INVALID_MODEL_OUTPUT');
    assert.equal(body.data,undefined);
  });
});

test('Heuristic mode never fabricates scores; successful AI report keeps official level null',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    const {data}=await (await post(base,high)).json();
    assert.equal(data.practiceScore,null);
    assert.equal(data.overall.score,null);
    assert.ok(Object.values(data.scores).every(v=>v===null));
    assert.equal(data.officialAssessment.level,null);
    assert.equal(data.scoreStatus,'not_scored');
  });
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:fakeFetch(wrap(cannedAi(high)))},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.data.mode,'ai');
    assert.equal(body.data.officialAssessment.level,null);
    assert.equal(Number.isInteger(body.data.practiceScore),true);
    assert.equal(body.meta.demoOnly,false);
  });
});

test('Provider timeout maps to 504 and provider HTTP failure maps to 502',async()=>{
  const abortFetch=async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'});};
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:abortFetch},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,504);
    assert.equal((await res.json()).error.code,'PROVIDER_TIMEOUT');
  });
  const httpFailFetch=async()=>({ok:false,status:500,json:async()=>({})});
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:httpFailFetch},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,502);
    assert.equal((await res.json()).error.code,'PROVIDER_HTTP_ERROR');
  });
});

test('CORS allows only the two local dev origins and handles OPTIONS preflight',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    for(const origin of ALLOWED_ORIGINS){
      const pre=await fetch(`${base}/api/evaluate`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}});
      assert.equal(pre.status,204);
      assert.equal(pre.headers.get('access-control-allow-origin'),origin);
      assert.match(pre.headers.get('access-control-allow-methods'),/POST/);
      const res=await post(base,high,{headers:{Origin:origin}});
      assert.equal(res.headers.get('access-control-allow-origin'),origin);
      assert.equal(res.headers.get('vary'),'Origin');
    }
    const evil='http://evil.example.com';
    const pre=await fetch(`${base}/api/evaluate`,{method:'OPTIONS',headers:{Origin:evil,'Access-Control-Request-Method':'POST'}});
    assert.equal(pre.status,403);
    assert.equal(pre.headers.get('access-control-allow-origin'),null);
    const res=await post(base,high,{headers:{Origin:evil}});
    assert.equal(res.headers.get('access-control-allow-origin'),null);
  });
});

test('Unknown routes and wrong methods return structured 404/405 errors',async()=>{
  await withServer({mode:'heuristic'},async base=>{
    assert.equal((await fetch(`${base}/nope`)).status,404);
    assert.equal((await fetch(`${base}/api/evaluate`)).status,405);
    assert.equal((await fetch(`${base}/health`,{method:'POST'})).status,405);
  });
});

test('Error responses never leak keys, stacks or request data',async()=>{
  const leakyFetch=async()=>{throw new Error('connection to api.openai.com failed with key TEST_KEY');};
  await withServer({mode:'ai',apiKey:'TEST_KEY',fetchImpl:leakyFetch},async base=>{
    const res=await post(base,high);
    assert.equal(res.status,502);
    const text=await res.text();
    assert.ok(!text.includes('TEST_KEY'));
    assert.ok(!text.includes('api.openai.com'));
    assert.ok(!text.includes('stack'));
    assert.ok(!text.includes(high.transcript.slice(0,30)));
  });
});

test('Fixed integration examples are valid and honor demo/heuristic contracts',()=>{
  const load=name=>JSON.parse(readFileSync(new URL(`../examples/${name}.json`,import.meta.url),'utf8'));
  const heuristic=load('http-success-heuristic');
  assert.equal(heuristic.success,true);
  assert.equal(heuristic.data.practiceScore,null);
  assert.equal(heuristic.meta.demoOnly,false);
  const demo=load('http-success-scored-demo');
  assert.equal(demo.success,true);
  assert.equal(demo.meta.demoOnly,true);
  assert.equal(demo.data.schemaVersion,'1.4.0');
  assert.equal(demo.data.practiceScore,81);
  assert.equal(demo.data.officialAssessment.level,null);
  assert.ok(demo.data.overall.disclaimer.includes('不是人大官方成绩'));
  assert.ok(demo.data.scorePolicy.disclaimer.includes('不是人大官方成绩'));
  const empty=load('http-error-empty-transcript');
  assert.equal(empty.success,false);
  assert.equal(empty.error.code,'EMPTY_TRANSCRIPT');
  const noKey=load('http-error-no-key');
  assert.equal(noKey.success,false);
  assert.equal(noKey.error.code,'API_KEY_MISSING');
});