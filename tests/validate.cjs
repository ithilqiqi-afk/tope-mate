'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ctx = {window:{}};
for (const file of ['config/exam-config.js','data/questions-c.js','data/questions-b.js','data/report-samples.js']) {
  new vm.Script(read(file), {filename:file}).runInNewContext(ctx);
  console.log('Loaded:', file);
}
for(const file of ['app.js']) new vm.Script(read(file),{filename:file});
const {TOPE_BANK_C:C, TOPE_BANK_B:B, TOPE_CONFIG:config, TOPE_CATEGORIES:categories, TOPE_QA_SAMPLES:qa, TOPE_REPORT_SAMPLES:reports}=ctx.window;
assert.ok(C && B && config && categories && qa && reports);
assert.ok(C.questions.length>0 && B.sets.length>0);
const uniq=(rows,label)=>assert.equal(new Set(rows.map(x=>x.id)).size,rows.length,`${label}: duplicate ids`);
uniq(C.questions,'C');uniq(B.sets,'B');
const cats=new Set(Array.from(categories, x=>x.key));
for(const item of C.questions){
  assert.ok(typeof item.id==='string' && item.id.trim());
  assert.ok(cats.has(item.cat),`C ${item.id} invalid cat`);
  assert.ok(typeof item.en==='string' && item.en.trim(),`C ${item.id} missing en`);
  assert.equal(typeof item.zh,'string');
}
for(const set of B.sets){
  assert.ok(cats.has(set.cat),`B ${set.id} invalid cat`);
  assert.ok(set.topic && set.discussion && typeof set.topicZh==='string' && typeof set.discussionZh==='string');
  assert.equal(set.cards.length,3,`B ${set.id} cards`);
  assert.equal(set.followUps.length,3,`B ${set.id} followUps`);
  assert.equal(Array.from(set.cards,x=>x.key).sort().join(''),'ABC',`B ${set.id} keys`);
  assert.equal(Array.from(set.followUps,x=>x.key).sort().join(''),'ABC',`B ${set.id} followUp keys`);
  for(const c of set.cards) assert.ok(c.point && typeof c.pointZh==='string');
  for(const f of set.followUps) assert.ok(f.q);
}
for (const type of ['B','C']) {
  assert.ok(config[type].phases.length);
  assert.equal(new Set(Array.from(config[type].phases,p=>p.key)).size,config[type].phases.length);
  for(const p of config[type].phases) assert.ok(p.seconds>0 && Number.isFinite(p.seconds));
}
assert.ok(Math.abs(Array.from(config.report.dimensions,x=>x.weight).reduce((a,b)=>a+b,0)-1)<1e-10);
for(const d of config.report.dimensions){assert.ok(Array.isArray(reports.dimensions[d.key]));assert.ok(Array.isArray(reports.nextSteps[d.key]));}
assert.ok(reports.overall.length);
const html=read('index.html');
for(const f of ['config/exam-config.js','data/questions-c.js','data/questions-b.js','data/report-samples.js','app.js']) assert.ok(html.includes('src="'+f+'"'),`HTML script missing ${f}`);
const contractDir=path.join(root,'docs/contracts');
for(const name of ['question-c.schema.json','question-b.schema.json','evaluation-request.schema.json','evaluation-response.schema.json','evaluation-error.schema.json']) {
  const s=JSON.parse(fs.readFileSync(path.join(contractDir,name)));
  assert.equal(s.type,'object');assert.ok(s.required && s.properties);
}
const sample=JSON.parse(read('docs/contracts/fixtures/evaluation-response.sample.json'));
assert.equal(sample.success,true);
assert.ok(sample.scores.overall>=0 && sample.scores.overall<=100);
for(const k of ['strengths','weaknesses','suggestions','evidence','improvedExpressions'])assert.ok(Array.isArray(sample[k]));
assert.ok(sample.evidence.every(e=>e.quote && e.comment));
console.log(`PASS: C=${C.questions.length}, B=${B.sets.length}, categories=${categories.length}, phases and candidate contract fixtures.`);
console.log('NOTE: No browser, recording, API, source authenticity or actual DOM rendering verification performed.');
