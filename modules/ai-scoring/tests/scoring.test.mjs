import './env-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreMock,scoreHeuristic,scoreResponse} from '../src/scorer.mjs';
import {scoreWithOpenAI,normalizeAIResult,SYSTEM_PROMPT} from '../src/provider.mjs';
import {validateRequest,blankResult,validateResponse} from '../src/contract.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';
import {getPracticeScoreConfig,calculatePracticeScore,calculateTimingScore,SCORE_VERSION,STAGE_SCORE_CONFIG} from '../src/practice-score.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
const high=fixture('c_high'),mid=fixture('c_medium'),low=fixture('c_low');
const countSignals=res=>Object.values(res.diagnostics.detectedSignals).filter(Boolean).length;
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
const fakeFetch=(answer,{status=200,check=()=>{}}={})=>async(_url,init)=>{
  check(init);
  return {ok:status>=200&&status<300,status,json:async()=>answer};
};
const wrap=payload=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});

test('Input validation catches invalid stage, duration, rubric and transcript length',()=>{
  assert.equal(validateRequest(high),true);
  assert.throws(()=>validateRequest({...high,stage:'discussion'}),/Unsupported/);
  assert.throws(()=>validateRequest({...high,durationSeconds:-1}),/durationSeconds/);
  assert.throws(()=>validateRequest({...high,rubric:{hidden:'changes'}}),/rubric/);
  assert.throws(()=>validateRequest({...high,transcript:'a'.repeat(30001)}),/transcript/);
});
test('All stage-specific product weights sum to 100 and are explicitly non-official',()=>{
  for(const req of [fixture('b_statement_high'),fixture('b_discussion_no_turns'),fixture('c_high'),fixture('c_qa')]){
    const cfg=getPracticeScoreConfig(req);
    assert.equal(Object.values(cfg.configuredWeights).reduce((a,b)=>a+b,0),100);
    assert.equal(cfg.weightBasis,'product_defined_not_official');
  }
  const self=getPracticeScoreConfig({examType:'B',stage:'self_intro',question:'Introduce yourself',transcript:'I am a student.',durationSeconds:35});
  assert.equal(Object.values(self.configuredWeights).reduce((a,b)=>a+b,0),100);
});
test('Mock and heuristic modes never fabricate AI practice scores',()=>{
  const mock=scoreMock(high),heuristic=scoreHeuristic(high);
  assert.equal(mock.mode,'mock');assert.equal(mock.practiceScore,null);assert.equal(mock.overall.score,null);
  assert.equal(heuristic.practiceScore,null);assert.equal(heuristic.overall.score,null);
  assert.ok(Object.values(heuristic.scores).every(v=>v===null));
});
test('Empty transcript returns explicit error without scoring',()=>{
  const x=scoreHeuristic({...high,transcript:'   '});
  assert.equal(x.errors[0].code,'EMPTY_TRANSCRIPT');assert.equal(x.overall.label,'insufficient_evidence');
  assert.equal(x.practiceScore,null);
});
test('Three C practice levels have descending text-signal coverage; heuristic is not a quality score',()=>{
  const h=scoreHeuristic(high),m=scoreHeuristic(mid),l=scoreHeuristic(low);
  assert.ok(countSignals(h)>countSignals(m));assert.ok(countSignals(m)>countSignals(l));
  assert.equal(h.peel.point,'partial');assert.equal(h.peel.example,'partial');
  assert.equal(m.peel.example,'absent');assert.equal(l.peel.explain,'absent');
  for(const out of [h,m,l]){
    assert.equal(out.practiceScore,null);assert.equal(out.overall.score,null);
    for(const e of out.evidence)assert.ok([high,mid,low].some(f=>f.transcript.includes(e.quote)));
  }
});
test('Three B statement levels have descending text-signal coverage',()=>{
  const levels=['b_statement_high','b_statement_medium','b_statement_low'].map(x=>scoreHeuristic(fixture(x)));
  assert.ok(countSignals(levels[0])>countSignals(levels[1]));
  assert.ok(countSignals(levels[1])>countSignals(levels[2]));
});
test('C QA does not force PEEL; B discussion without turns leaves interaction unassessed',()=>{
  const qa=scoreHeuristic(fixture('c_qa'));
  assert.equal(qa.peel.point,'not_assessed');
  const discussion=scoreHeuristic(fixture('b_discussion_no_turns'));
  assert.equal(discussion.scores.interaction,null);
  assert.ok(discussion.unassessed.includes('interaction'));
  assert.ok(discussion.unassessed.includes('group_interaction_without_speaker_turns'));
});
test('Timing dimension is not assessed without target duration',()=>{
  const req={...high};delete req.targetDurationSeconds;
  const cfg=getPracticeScoreConfig(req);
  assert.ok(!cfg.assessedDimensions.includes('timeManagement'));
  assert.ok(cfg.notAssessedDimensions.includes('timeManagement'));
  assert.equal(calculateTimingScore(req.durationSeconds,undefined),null);
});
test('Fixed timing rule is deterministic and bounded',()=>{
  assert.equal(calculateTimingScore(180,180),100);
  assert.equal(calculateTimingScore(165,180),100);
  assert.equal(calculateTimingScore(144,180),90);
  assert.equal(calculateTimingScore(126,180),80);
  assert.equal(calculateTimingScore(108,180),65);
  assert.equal(calculateTimingScore(90,180),50);
  assert.equal(calculateTimingScore(60,180),35);
});
test('Weighted score is computed by backend and rounded; time score is backend-calculated',()=>{
  const result=calculatePracticeScore(high,{relevance:80,organization:70,development:75,language:85,taskCompletion:80,timeManagement:null,interaction:null});
  assert.equal(result.practiceScore,81);
  assert.equal(result.scores.timeManagement,100);
  assert.equal(result.scoreStatus,'complete');
  assert.equal(result.scoreCoverage.coveragePercent,100);
  assert.equal(result.scorePolicy.weightBasis,'product_defined_not_official');
});
test('Unassessed dimensions are excluded and remaining weights renormalized',()=>{
  const req=fixture('b_discussion_no_turns');
  const result=calculatePracticeScore(req,{relevance:80,development:70,language:75,interaction:99,taskCompletion:85,timeManagement:null,organization:null});
  assert.equal(result.scores.interaction,null);
  assert.equal(result.scoreCoverage.coveragePercent,75);
  assert.equal(result.scoreStatus,'partial');
  assert.equal(result.practiceScore,78);
  assert.ok(result.scoreCoverage.notAssessedDimensions.includes('interaction'));
});
test('B discussion interaction becomes assessable only with target and other-speaker turns',()=>{
  const req={...fixture('b_discussion_no_turns'),assessedSpeaker:'B',speakerTurns:[{speaker:'A',text:'Volunteering should be compulsory.'},{speaker:'B',text:'I understand, but some students already have jobs.'}]};
  const cfg=getPracticeScoreConfig(req);
  assert.ok(cfg.assessedDimensions.includes('interaction'));
  const raw=cannedAi(req,{scores:{...cannedAi(req).scores,interaction:88}});
  const result=normalizeAIResult(raw,req);
  assert.equal(result.scores.interaction,88);
  assert.equal(result.scoreCoverage.coveragePercent,100);
});
test('No interaction turn data means a model cannot sneak in an interaction score',()=>{
  const req=fixture('b_discussion_no_turns');
  const raw=cannedAi(req,{scores:{...cannedAi(req).scores,interaction:99}});
  assert.throws(()=>normalizeAIResult(raw,req),/Inactive dimension/);
});
test('AI normalization computes practiceScore and preserves official level as null',()=>{
  const raw=cannedAi(high,{scores:{...cannedAi(high).scores,relevance:80,organization:70,development:75,language:85,taskCompletion:80}});
  const result=normalizeAIResult(raw,high);
  assert.equal(result.practiceScore,81);
  assert.equal(result.overall.score,result.practiceScore);
  assert.equal(result.overall.label,'practice_reference');
  assert.equal(result.officialAssessment.level,null);
  assert.equal(result.scoreVersion,SCORE_VERSION);
  assert.ok(result.dimensionFeedback.some(x=>x.dimension==='timeManagement'&&x.score===100));
});
test('Model cannot provide aggregate score or official grade',()=>{
  const raw=cannedAi(high,{practiceScore:88});
  assert.throws(()=>normalizeAIResult(raw,high),/must not return an aggregate/);
  const bad=cannedAi(high,{officialAssessment:{...blankResult(high).officialAssessment,level:6}});
  assert.throws(()=>normalizeAIResult(bad,high),/official level/);
});
test('Evidence validation rejects invented transcript quote and rewritten source',()=>{
  const valid=cannedAi(high);assert.equal(validateResponse(valid,high,{requireAi:true}),true);
  assert.throws(()=>validateResponse({...valid,evidence:[{quote:'Invented quote',observation:'x',dimension:'language'}]},high),/verbatim/);
  assert.throws(()=>validateResponse({...valid,improvedExpressions:[{original:'Not the user words',suggested:'x',reason:'y'}]},high),/verbatim/);
});
test('Dimension feedback quote may cite exact supplied speaker turn text only',()=>{
  const req={...fixture('b_discussion_no_turns'),assessedSpeaker:'B',speakerTurns:[{speaker:'A',text:'Volunteering should be compulsory.'},{speaker:'B',text:'I understand, but some students already have jobs.'}]};
  const raw=cannedAi(req);
  raw.dimensionFeedback.find(x=>x.dimension==='interaction').evidenceQuotes=['Volunteering should be compulsory.'];
  assert.equal(validateResponse(raw,req,{requireAi:true}),true);
  raw.dimensionFeedback.find(x=>x.dimension==='interaction').evidenceQuotes=['Fabricated words'];
  assert.throws(()=>validateResponse(raw,req,{requireAi:true}),/verbatim/);
});
test('AI request uses strict schema and passes stage weights to model',async()=>{
  const raw=cannedAi(high);let called=0;
  const fetched=fakeFetch(wrap(raw),{check:init=>{
    called++;
    const sent=JSON.parse(init.body);
    assert.equal(sent.store,false);assert.equal(sent.text.format.type,'json_schema');
    assert.equal(sent.text.format.strict,true);assert.ok(sent.text.format.schema.properties.dimensionFeedback);
    assert.equal(init.headers.Authorization,'Bearer TEST_KEY');
    assert.ok(sent.instructions.includes('backend calculates'));
    const input=JSON.parse(sent.input);
    assert.equal(input.practiceScoreConfig.weightBasis,'product_defined_not_official');
    assert.equal(input.practiceScoreConfig.weights.relevance,30);
  }});
  const out=await scoreWithOpenAI(high,{apiKey:'TEST_KEY',model:'gpt-4o-mini',fetchImpl:fetched});
  assert.equal(called,1);assert.equal(out.mode,'ai');assert.equal(out.errors.length,0);
  assert.equal(out.practiceScore,82);
});
test('Model refuses or supplies invented quote: fail closed',async()=>{
  const refusal=fakeFetch({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]});
  assert.equal((await scoreWithOpenAI(high,{apiKey:'X',fetchImpl:refusal})).errors[0].code,'PROVIDER_REFUSAL');
  const bad=cannedAi(high,{evidence:[{quote:'NEVER SAID THIS',observation:'x',dimension:'language'}]});
  const fetched=fakeFetch(wrap(bad));
  assert.equal((await scoreWithOpenAI(high,{apiKey:'X',fetchImpl:fetched})).errors[0].code,'INVALID_MODEL_OUTPUT');
});
test('Provider HTTP error, missing key, network failure return structured error',async()=>{
  assert.equal((await scoreWithOpenAI(high,{apiKey:''})).errors[0].code,'API_KEY_MISSING');
  assert.equal((await scoreWithOpenAI(high,{apiKey:'X',fetchImpl:fakeFetch(null,{status:503})})).errors[0].code,'PROVIDER_HTTP_ERROR');
  assert.equal((await scoreWithOpenAI(high,{apiKey:'X',fetchImpl:async()=>{throw new Error('broken')}})).errors[0].code,'PROVIDER_NETWORK_ERROR');
});
test('Empty transcript must not make external provider call',async()=>{
  const out=await scoreWithOpenAI({...high,transcript:''},{apiKey:'X',fetchImpl:async()=>{throw new Error('Provider should not be called')}});
  assert.equal(out.errors[0].code,'EMPTY_TRANSCRIPT');
});
test('AI strict schema is closed and requires backend-only aggregate placeholders',()=>{
  assert.equal(AI_SCHEMA.additionalProperties,false);
  assert.equal(AI_SCHEMA.required.length,Object.keys(AI_SCHEMA.properties).length);
  assert.equal(AI_SCHEMA.properties.practiceScore.type,'null');
  assert.equal(AI_SCHEMA.properties.overall.properties.score.type,'null');
  assert.equal(AI_SCHEMA.properties.scores.properties.timeManagement.type,'null');
  assert.equal(scoreResponse(high,{mode:'mock'}).mode,'mock');
});
test('Official B and C basis remains visible but separate from product scoring',()=>{
  for(const [req,area,expected] of [
    [fixture('b_statement_high'),'陈述与讨论',['话题内容','讨论参与及语用适切','交际任务完成']],
    [fixture('c_high'),'演讲与问答',['话题内容与论述','词汇语法及语音语调','时间控制']]]){
    const result=scoreHeuristic(req);
    assert.equal(result.rubricBasis.area,area);
    assert.deepEqual(result.rubricBasis.dimensions,expected);
    assert.ok(result.rubricBasis.assessmentMethod.includes('独立产品指标'));
    assert.match(result.rubricBasis.verificationStatus,/1–6级/);
    assert.equal(result.officialAssessment.level,null);
  }
});
test('Legacy practice_v1 request is accepted but output carries new score version',()=>{
  const result=scoreMock({...high,rubric:'practice_v1'});
  assert.equal(result.scoreVersion,SCORE_VERSION);
  assert.equal(result.practiceScore,null);
});


test('Comparison key is stable only for the same score, prompt, model and evidence configuration',()=>{
  const req=fixture('c_high');
  const a=getPracticeScoreConfig(req,{modelId:'gpt-4o-mini'});
  const same=getPracticeScoreConfig(req,{modelId:'gpt-4o-mini'});
  const otherModel=getPracticeScoreConfig(req,{modelId:'another-model'});
  const otherStage=getPracticeScoreConfig({...req,stage:'qa'},{modelId:'gpt-4o-mini'});
  assert.equal(a.comparisonKey,same.comparisonKey);
  assert.notEqual(a.comparisonKey,otherModel.comparisonKey);
  assert.notEqual(a.comparisonKey,otherStage.comparisonKey);
  assert.ok(a.comparisonKey.includes('tope_practice_prompt_v0.6.0'));
});

test('Normalized AI report records model and prompt versions for longitudinal comparison',()=>{
  const raw=cannedAi(high);
  const result=normalizeAIResult(raw,high,{modelId:'gpt-4o-mini-2026-01'});
  assert.equal(result.scorePolicy.modelId,'gpt-4o-mini-2026-01');
  assert.equal(result.scorePolicy.scope,'stage');
  assert.equal(result.scorePolicy.promptVersion,'tope_practice_prompt_v0.6.0');
  assert.ok(result.scoreCoverage.comparisonKey.includes('gpt-4o-mini-2026-01'));
});

test('Examiner-only turns do not count as B peer interaction evidence',()=>{
  const req={...fixture('b_discussion_no_turns'),assessedSpeaker:'B',speakerTurns:[
    {speaker:'B',text:'I think students need enough rest.'},
    {speaker:'examiner',text:'Can you explain why?'}
  ]};
  assert.equal(getPracticeScoreConfig(req).assessedDimensions.includes('interaction'),false);
  assert.equal(scoreHeuristic(req).scores.interaction,null);
});

test('Official dimensions in output match the uploaded B/C rating-table screenshots',()=>{
  const b=scoreHeuristic(fixture('b_statement_high')).rubricBasis.dimensions;
  const c=scoreHeuristic(fixture('c_high')).rubricBasis.dimensions;
  assert.deepEqual(b,['话题内容','讨论参与及语用适切','交际任务完成']);
  assert.deepEqual(c,['话题内容与论述','词汇语法及语音语调','时间控制']);
  assert.match(scoreHeuristic(fixture('c_qa')).rubricBasis.verificationStatus,/不据此虚构单独的 Q&A 官方权重/);
});


test('Canonical v0.6 system prompt keeps official descriptors separate from product score',()=>{
  assert.match(SYSTEM_PROMPT,/internal 0–100 TOPE Mate Practice Score/i);
  assert.match(SYSTEM_PROMPT,/not a conversion of official levels/i);
  assert.match(SYSTEM_PROMPT,/Examiner-only turns do not count/);
  assert.match(SYSTEM_PROMPT,/Do NOT calculate or output practiceScore/);
  assert.doesNotMatch(SYSTEM_PROMPT,/schemaVersion='1\.2\.0'/);
});


test('Provider response model identifier is preserved in Practice Score comparison metadata',async()=>{
  const req=fixture('c_high');
  const raw=cannedAi(req);
  const responseBody={...wrap(raw),model:'gpt-4o-mini-2026-11-21'};
  const out=await scoreWithOpenAI(req,{apiKey:'TEST_KEY',model:'gpt-4o-mini',fetchImpl:async()=>({ok:true,status:200,json:async()=>responseBody})});
  assert.equal(out.scorePolicy.modelId,'gpt-4o-mini-2026-11-21');
  assert.ok(out.scoreCoverage.comparisonKey.includes('gpt-4o-mini-2026-11-21'));
});


test('Machine-readable policy weights stay synchronized with runtime stage weights',()=>{
  const policy=JSON.parse(readFileSync(new URL('../data/practice_score_policy.json',import.meta.url),'utf8'));
  assert.equal(policy.moduleVersion,'0.6.0');
  assert.equal(policy.promptVersion,'tope_practice_prompt_v0.6.0');
  for(const examType of ['B','C']){
    for(const stage of Object.keys(STAGE_SCORE_CONFIG[examType])){
      assert.deepEqual(policy.weights[examType][stage],STAGE_SCORE_CONFIG[examType][stage].weights);
      assert.equal(Object.values(policy.weights[examType][stage]).reduce((a,b)=>a+b,0),100);
    }
  }
});
