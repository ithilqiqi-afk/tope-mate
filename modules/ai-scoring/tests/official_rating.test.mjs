import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRequest,validateResponse} from '../src/contract.mjs';
import {scoreHeuristic} from '../src/scorer.mjs';
import {normalizeAIResult} from '../src/provider.mjs';
import {AI_SCHEMA} from '../src/ai-schema.mjs';
const read = path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const bands=read('../data/official_rating_descriptors.json');
const samples=read('../data/official_sample_questions.json');
const fixture=name=>read(`../fixtures/${name}.json`);
test('B and C each have all six official holistic rating anchors (summary, not official text)',()=>{
  for(const type of ['B','C']){
    const exam=bands.exams[type];
    assert.deepEqual(Object.keys(exam.levels).sort(),['1','2','3','4','5','6']);
    for(let level=1;level<=6;level++){
      assert.equal(exam.levels[level].length,3);
      assert.ok(exam.levels[level].every(s=>typeof s==='string'&&s.trim().length>0));
    }
  }
  assert.equal(bands.gradingPolicy.method.includes('整体'),true);
});
test('Official B sample preserves 3 individual cards and 60/90/300 second durations',()=>{
  assert.deepEqual(samples.B.cards,{A:'Academic Pressure',B:'Financial Pressure',C:'Future Employment Pressure'});
  assert.equal(samples.B.format.presentation.preparationSeconds,60);
  assert.equal(samples.B.format.presentation.individualSpeakingSeconds,90);
  assert.equal(samples.B.format.groupDiscussion.totalSecondsApprox,300);
});
test('Official C sample contains speech question and two linked Q&A prompts',()=>{
  assert.ok(samples.C.speechTopic.includes('honesty'));
  assert.equal(samples.C.followUps.length,2);
});
for(const stage of ['official_b_pressure_statement','official_b_pressure_discussion','official_c_honesty_speech','official_c_honesty_qa']){
  test(`official fixture ${stage} is valid and never receives unofficial grade`,()=>{
    const req=fixture(stage);
    assert.equal(validateRequest(req),true);
    const out=scoreHeuristic(req);
    assert.equal(out.officialAssessment.level,null);
    assert.equal(out.officialAssessment.scaleMin,1);
    assert.equal(out.officialAssessment.scaleMax,6);
    assert.equal(out.overall.score,null);
    assert.ok(Object.values(out.scores).every(x=>x===null));
    assert.match(out.rubricBasis.verificationStatus,/1–6级/);
  });
}
test('AI strict schema requires a null official rating',()=>{
  const schema=AI_SCHEMA.properties.officialAssessment;
  assert.equal(schema.properties.level.type,'null');
  assert.equal(schema.required.length,Object.keys(schema.properties).length);
});
test('API response with invented official grade is rejected',()=>{
  const req=fixture('official_c_honesty_speech');
  const raw=scoreHeuristic(req);
  const bad={...raw,mode:'ai',officialAssessment:{...raw.officialAssessment,level:6}};
  assert.throws(()=>validateResponse(bad,req,{requireAi:true}),/official level/);
  assert.throws(()=>normalizeAIResult(bad,req),/official level/);
});
test('PEEL only used for presentation or speech; QA and group discussion do not force it',()=>{
  assert.equal(scoreHeuristic(fixture('official_c_honesty_qa')).peel.point,'not_assessed');
  assert.equal(scoreHeuristic(fixture('official_b_pressure_discussion')).peel.point,'not_assessed');
  assert.equal(scoreHeuristic(fixture('official_b_pressure_statement')).peel.point,'partial');
});
