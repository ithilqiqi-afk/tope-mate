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
for(const f of ['config/exam-config.js','services/transcription.js','services/evaluation.js','services/ai-pipeline.js','recorder.js','data/questions-c.js','data/questions-b.js','data/report-samples.js','app.js']) assert.ok(html.includes('src="'+f+'"'),`HTML script missing ${f}`);
/* 加载顺序：转写/评分/流水线必须在 app.js 之前，app.js 启动时才能直接调用 window.TOPE_* */
const order=f=>html.indexOf('src="'+f+'"');
assert.ok(order('services/ai-pipeline.js')<order('app.js')&&order('services/transcription.js')<order('app.js')&&order('services/evaluation.js')<order('app.js'),'服务层脚本要在 app.js 之前加载');
/* 评分服务的阶段映射必须覆盖所有会录音的阶段 */
for(const type of ['B','C']) for(const p of config[type].phases){
  if(!p.record) continue;
  assert.ok(config.scoringStages[p.key],`${type}/${p.key} 录音阶段缺少 scoringStages 映射`);
}
assert.equal(config.scoringStages.prepare,undefined,'prepare 没有口头产出，不该映射到评分阶段');
const contractDir=path.join(root,'docs/contracts');

/* ---------- 评分契约 Schema 1.4.0 结构校验（对齐 modules/ai-scoring/src/contract.mjs） ---------- */
const SCHEMA_VERSION='1.4.0';
const DIMENSIONS=['relevance','organization','development','language','interaction','taskCompletion','timeManagement'];
const STAGE_BY_EXAM={B:['self_intro','statement','discussion'],C:['speech','qa']};
const REPORT_KEYS=['schemaVersion','mode','examType','stage','practiceScore','scoreVersion','scoreStatus','scorePolicy','scoreCoverage',
  'overall','rubricBasis','officialAssessment','scores','dimensionFeedback','strengths','weaknesses','suggestions','evidence',
  'peel','peelDetails','improvedExpressions','nextPractice','diagnostics','unassessed','errors'];
const PEEL_KEYS=['point','explain','example','link'];
const PEEL_STATUS=['present','partial','absent','not_assessed'];
const isPlain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isStr=v=>typeof v==='string';
const isNullableScore=v=>v===null||(Number.isInteger(v)&&v>=0&&v<=100);
const assertReq=(cond,msg,label)=>assert.ok(cond,`${label}: ${msg}`);

/** 与 validateRequest() 同口径的请求校验，防止前端悄悄发出旧字段。 */
function checkEvaluationRequest(req,label){
  assertReq(isPlain(req),'request must be an object',label);
  assertReq(STAGE_BY_EXAM[req.examType]?.includes(req.stage),`unsupported examType/stage ${req.examType}/${req.stage}`,label);
  assertReq(isStr(req.question)&&req.question.trim()&&req.question.length<=3000,'question must be a 1..3000 char string',label);
  if(req.questionId!==undefined)assertReq(isStr(req.questionId)&&req.questionId.trim()&&req.questionId.length<=128,'questionId must be a 1..128 char string',label);
  assertReq(isStr(req.transcript)&&req.transcript.length<=30000,'transcript must be a <=30000 char string',label);
  assertReq(typeof req.durationSeconds==='number'&&Number.isFinite(req.durationSeconds)&&req.durationSeconds>=0&&req.durationSeconds<=3600,'durationSeconds must be 0..3600',label);
  if(req.targetDurationSeconds!==undefined)assertReq(Number.isFinite(req.targetDurationSeconds)&&req.targetDurationSeconds>0&&req.targetDurationSeconds<=3600,'targetDurationSeconds must be 1..3600',label);
  if(req.rubric!==undefined&&req.rubric!==null)assertReq(isStr(req.rubric)&&req.rubric.length<=200,'rubric must be a short label or null',label);
  if(req.assessedSpeaker!==undefined)assertReq(['A','B','C'].includes(req.assessedSpeaker),'assessedSpeaker must be A/B/C',label);
  if(req.speakerTurns!==undefined){
    assertReq(Array.isArray(req.speakerTurns)&&req.speakerTurns.length<=150,'speakerTurns must be an array of <=150',label);
    for(const t of req.speakerTurns)assertReq(isPlain(t)&&['A','B','C','examiner'].includes(t.speaker)&&isStr(t.text)&&t.text.length<=3000,'speakerTurns items need speaker/text',label);
  }
  /* 音频永远不该出现在评分请求里。 */
  for(const forbidden of ['audio','audioBase64','recording','transcriptBase64'])
    assertReq(!(forbidden in req),`${forbidden} must never be sent to the scoring service`,label);
}

function checkErrorEnvelope(env,label){
  assertReq(env.success===false,'failed payload must carry success:false',label);
  assertReq(Object.keys(env).sort().join(',')==='error,success','failure envelope has no data field',label);
  assertReq(isPlain(env.error),'error must be an object',label);
  assertReq(Object.keys(env.error).sort().join(',')==='code,message,retryable','error needs code/message/retryable',label);
  assertReq(isStr(env.error.code)&&env.error.code.trim(),'error.code must be non-empty',label);
  assertReq(isStr(env.error.message)&&env.error.message.trim(),'error.message must be non-empty',label);
  assertReq(typeof env.error.retryable==='boolean','error.retryable must be boolean',label);
}

/** 只按报告自身字段复算聚合分：与 B 的加权重归一化公式必须对得上。 */
function checkReportEnvelope(env,request,label){
  assertReq(env.success===true,'success payload must carry success:true',label);
  assertReq(isPlain(env.data)&&isPlain(env.meta),`envelope must be {success,data,meta}`,label);
  assertReq('questionId'in env.meta&&'demoOnly'in env.meta,'meta needs questionId and demoOnly',label);
  assertReq(typeof env.meta.demoOnly==='boolean','meta.demoOnly must be boolean',label);
  if(request)assertReq(env.meta.questionId===(request.questionId??null),'meta.questionId must echo the request',label);
  const d=env.data;
  for(const k of REPORT_KEYS)assertReq(k in d,`report missing ${k}`,label);
  assertReq(d.schemaVersion===SCHEMA_VERSION,`schemaVersion must be ${SCHEMA_VERSION}, got ${d.schemaVersion}`,label);
  assertReq(['ai','heuristic','mock'].includes(d.mode),'unknown report mode',label);
  assertReq(STAGE_BY_EXAM[d.examType]?.includes(d.stage),'report stage mismatch',label);
  /* v0.1 候选协议的任何残留都不允许回来。 */
  for(const legacy of ['version','notAssessed','dimensionScores','overallScore'])assertReq(!(legacy in d),`deprecated v0.1 field ${legacy} is present`,label);
  assertReq(!('overall'in d.scores)&&!('dimensions'in d.scores),'scores must be flat per dimension, not scores.overall/scores.dimensions',label);

  assertReq(isNullableScore(d.practiceScore),'practiceScore must be null or 0..100 integer',label);
  assertReq(['complete','partial','not_scored'].includes(d.scoreStatus),'bad scoreStatus',label);
  assertReq(Number.isInteger(d.diagnostics?.wordCount)&&d.diagnostics.wordCount>=0,'diagnostics.wordCount must be a non-negative integer',label);
  assertReq(isStr(d.overall?.disclaimer)&&d.overall.disclaimer.trim(),'overall.disclaimer is required',label);
  assertReq(d.overall.score===d.practiceScore,'overall.score must alias practiceScore exactly',label);
  assertReq(d.overall.maxScore===100,'overall.maxScore must be 100',label);
  assertReq(['practice_reference','not_scored','insufficient_evidence'].includes(d.overall.label),'bad overall.label',label);
  assertReq(d.officialAssessment.level===null,'official level must stay null',label);
  assertReq(d.officialAssessment.scaleMin===1&&d.officialAssessment.scaleMax===6,'official bands stay 1..6',label);
  assertReq(d.scorePolicy.scope==='stage','practice score scope must be a single stage',label);
  assertReq(d.scorePolicy.weightBasis==='product_defined_not_official','weights must be labelled product-defined',label);
  assertReq(isStr(d.scorePolicy.disclaimer)&&d.scorePolicy.disclaimer.trim(),'scorePolicy.disclaimer is required',label);

  assertReq(Object.keys(d.scores).sort().join(',')===DIMENSIONS.slice().sort().join(','),'scores keys must be exactly the 7 dimensions',label);
  for(const dim of DIMENSIONS)assertReq(isNullableScore(d.scores[dim]),`scores.${dim} must be null or 0..100`,label);

  const cov=d.scoreCoverage,pol=d.scorePolicy;
  assertReq(cov.configuredWeight===Object.values(pol.configuredWeights).reduce((a,b)=>a+b,0),'scoreCoverage.configuredWeight must equal the sum of configuredWeights',label);
  for(const dim of cov.assessedDimensions)assertReq(dim in pol.configuredWeights,`assessed dimension ${dim} has no configured weight`,label);
  assertReq(cov.assessedWeight===cov.assessedDimensions.reduce((a,k)=>a+pol.configuredWeights[k],0),'scoreCoverage.assessedWeight mismatch',label);
  assertReq(cov.coveragePercent===Math.round(cov.assessedWeight/cov.configuredWeight*100),'coveragePercent does not follow assessedWeight/configuredWeight',label);
  assertReq(isStr(cov.comparisonKey)&&cov.comparisonKey.includes(`${d.examType}|${d.stage}`),'comparisonKey must bind examType and stage',label);
  const included=cov.assessedDimensions.filter(k=>Number.isInteger(d.scores[k]));
  assertReq(included.length===cov.assessedDimensions.length,'assessed dimensions must all carry a score or the coverage is wrong',label);
  const weight=included.reduce((a,k)=>a+pol.configuredWeights[k],0);
  const expected=weight?Math.round(included.reduce((a,k)=>a+d.scores[k]*pol.configuredWeights[k],0)/weight):null;
  assertReq(d.practiceScore===expected,`practiceScore must equal the weighted average (${expected}), got ${d.practiceScore}`,label);
  if(d.scoreStatus==='complete'){
    assertReq(Number.isInteger(d.practiceScore),'complete requires a practice score',label);
    assertReq(cov.coveragePercent===100,'complete requires full coverage',label);
  }
  if(d.scoreStatus==='partial'){
    assertReq(cov.coveragePercent>0&&cov.coveragePercent<100,'partial requires partial coverage',label);
    assertReq(cov.notAssessedDimensions.length>0,'partial must name the unassessed dimensions',label);
  }
  if(d.mode==='heuristic'){
    assertReq(d.practiceScore===null&&d.scoreStatus==='not_scored','heuristic reports must not carry a practice score',label);
    assertReq(cov.coveragePercent===0,'heuristic reports must not claim coverage',label);
    assertReq(DIMENSIONS.every(k=>d.scores[k]===null),'heuristic reports must leave every dimension unassessed',label);
  }
  if(d.practiceScore===null)assertReq(d.overall.label!=='practice_reference','an unscored report must not be labelled practice_reference',label);

  const seen=new Set();
  const quoteSources=[request?.transcript,...(request?.speakerTurns||[]).map(t=>t.text)].filter(isStr);
  for(const item of d.dimensionFeedback){
    assertReq(isPlain(item)&&DIMENSIONS.includes(item.dimension),'dimensionFeedback dimension unknown',label);
    assertReq(!seen.has(item.dimension),'dimensionFeedback has duplicate dimension',label);
    seen.add(item.dimension);
    assertReq(isStr(item.rationale)&&item.rationale.trim(),'dimensionFeedback needs a rationale',label);
    assertReq(Array.isArray(item.evidenceQuotes)&&item.evidenceQuotes.every(q=>isStr(q)&&q.trim()),'evidenceQuotes must be non-empty strings',label);
    assertReq(Number.isInteger(item.score)&&item.score>=0&&item.score<=100,`${item.dimension} feedback score must be 0..100`,label);
    assertReq(item.weight===pol.configuredWeights[item.dimension],'feedback weight must match scorePolicy',label);
    if(quoteSources.length)for(const q of item.evidenceQuotes)assertReq(quoteSources.some(s=>s.includes(q)),`feedback quote is not verbatim: ${q.slice(0,40)}`,label);
  }
  for(const item of d.evidence){
    assertReq(isPlain(item)&&isStr(item.quote)&&item.quote.trim()&&isStr(item.observation)&&isStr(item.dimension),'evidence needs quote/observation/dimension',label);
    assertReq(!('comment'in item),'evidence uses observation, not the deprecated comment',label);
    if(request)assertReq(request.transcript.includes(item.quote),`evidence must quote the transcript verbatim: ${item.quote.slice(0,40)}`,label);
  }
  for(const k of PEEL_KEYS){
    assertReq(PEEL_STATUS.includes(d.peel[k]),`peel.${k} status invalid`,label);
    const entry=d.peelDetails[k];
    assertReq(isPlain(entry)&&(entry.quote===null||isStr(entry.quote))&&isStr(entry.note),`peelDetails.${k} shape invalid`,label);
    if(request&&entry.quote)assertReq(request.transcript.includes(entry.quote),`invented PEEL quote in ${k}`,label);
  }
  for(const item of d.improvedExpressions){
    assertReq(isPlain(item)&&isStr(item.original)&&isStr(item.suggested)&&isStr(item.reason),'improvedExpressions need original/suggested/reason',label);
    if(request&&item.original)assertReq(request.transcript.includes(item.original),'improvedExpressions.original must be verbatim',label);
  }
  for(const k of ['strengths','weaknesses','suggestions','nextPractice','unassessed','errors'])
    assertReq(Array.isArray(d[k]),`${k} must be an array`,label);
  for(const k of ['strengths','weaknesses','suggestions','nextPractice','unassessed'])
    assertReq(d[k].every(isStr),`${k} must hold strings`,label);
  assertReq(d.errors.every(e=>isPlain(e)&&isStr(e.code)&&isStr(e.message)),'errors items need code/message',label);
  /* 只有文本证据：这三项永远算未评估。 */
  for(const k of ['pronunciation','prosody','audio_fluency'])
    assertReq(d.unassessed.includes(k),`unassessed must list ${k}`,label);
  if(request?.examType==='B'&&request?.stage==='discussion'&&!isStr(request.assessedSpeaker)){
    const noTurns=!Array.isArray(request.speakerTurns)||!request.speakerTurns.some(t=>t.speaker!=='examiner'&&t.text.trim());
    if(noTurns)assertReq(d.scores.interaction===null,'interaction must stay null without real peer turns',label);
  }
}

function checkScoringContract(requestPath,responsePath){
  const label=responsePath;
  const request=requestPath?JSON.parse(read(requestPath)):null;
  if(request)checkEvaluationRequest(request,requestPath);
  const env=JSON.parse(read(responsePath));
  if(env.success===false)return checkErrorEnvelope(env,label);
  return checkReportEnvelope(env,request,label);
}
for(const name of ['question-c.schema.json','question-b.schema.json','evaluation-request.schema.json','evaluation-response.schema.json','evaluation-error.schema.json']) {
  const s=JSON.parse(fs.readFileSync(path.join(contractDir,name)));
  assert.equal(s.type,'object');assert.ok(s.required && s.properties);
}
checkScoringContract('docs/contracts/fixtures/evaluation-request.sample.json','docs/contracts/fixtures/evaluation-response.sample.json');
checkScoringContract('docs/contracts/fixtures/evaluation-request-b-discussion.sample.json','docs/contracts/fixtures/evaluation-response-partial.sample.json');
/* B 自己发布的 HTTP 样例也必须符合同一结构，否则 Schema 一 drift 就该在这里失败。 */
checkScoringContract(null,'modules/ai-scoring/examples/http-success-heuristic.json');
checkScoringContract(null,'modules/ai-scoring/examples/http-success-scored-demo.json');
checkScoringContract(null,'modules/ai-scoring/examples/http-error-no-key.json');
checkScoringContract(null,'modules/ai-scoring/examples/http-error-empty-transcript.json');
assert.deepEqual(JSON.parse(read('docs/contracts/fixtures/evaluation-error.sample.json')),{
  success:false,error:{code:'API_KEY_MISSING',message:'服务器尚未配置 AI 评分所需的 API Key，请联系管理员或改用离线模式。',retryable:false}
});

/* Windows 启动脚本：cmd.exe 按字节偏移重读批处理，UTF-8 或裸 LF 会让它报
   「文件名、目录名或卷标语法不正确」；而 start "标题" "xx.cmd" "参数" 这种
   引号形态根本不会执行目标脚本。两类事故都在这里钉死。 */
const BAT=['启动 AI 后端.bat','停止 AI 后端.bat','启动预览.bat','tools/serve-with-env.cmd'];
for(const rel of BAT){
  const buf=fs.readFileSync(path.join(root,rel));
  assert.ok(!/[^\x00-\x7F]/.test(buf.toString('latin1')),`${rel}: must stay ASCII (chcp 65001 + UTF-8 breaks cmd parsing)`);
  assert.ok(!/(^|[^\r])\n/.test(buf.toString('latin1')),`${rel}: must use CRLF line endings`);
}
{
  const launcher=read('启动 AI 后端.bat');
  const starts=launcher.split(/\r\n/).filter(l=>/^\s*start\s/.test(l));
  assert.equal(starts.length,2,'AI launcher must start exactly the scoring and transcription services');
  for(const line of starts){
    assert.ok(/cmd \/c call "/.test(line),`start line needs the "cmd /c call" layer: ${line}`);
    assert.ok(!/start\s+"[^"]*"\s+"[^"]*\.cmd"\s+"/.test(line),`start must not pass quoted args straight to a .cmd path: ${line}`);
  }
  assert.ok(starts.some(l=>l.includes('ai-scoring')&&/3001/.test(l)),'launcher must start ai-scoring on 3001');
  assert.ok(starts.some(l=>l.includes('speech-transcription')&&/3002/.test(l)),'launcher must start speech-transcription on 3002');
}
{
  const helper=read('tools/serve-with-env.cmd');
  assert.ok(/echo \[TOPE Mate\] Service cannot start/.test(helper),'helper must name the failing service instead of exiting silently');
  for(const label of [':no_folder',':no_node',':no_entry',':no_args',':env_failed']){
    assert.ok(helper.includes(label+`\r`),`helper must branch to ${label}`);
  }
  assert.ok(/node src\\http-server\.mjs/.test(helper),'helper must run the module entry point directly (zero npm dependencies)');
  assert.ok(!/for \/f "usebackq[^)]*env-lines\.mjs/.test(helper),'helper must not pipe .env lines through for /f + call (carets in a key get eaten)');
  assert.ok(/env-lines\.mjs" "\.env" "%ENVBAT%"/.test(helper),'helper must load .env through a generated temp batch file');
  assert.ok(/del "%ENVBAT%"/.test(helper),'helper must delete the temp batch file that held the key');
}
{
  const loader=read('tools/env-lines.mjs');
  for(const blocked of ['"path"','"node_options"','"comspec"','"prompt"']){
    assert.ok(loader.includes(blocked),`env loader must refuse to override ${blocked}`);
  }
  assert.ok(loader.includes('replace(/%/g, "%%")'),'env loader must double % so batch re-parsing keeps the value intact');
}
{
  const preview=read('启动预览.bat');
  assert.ok(/127\.0\.0\.1:%PORT%\.\*LISTENING/.test(preview),'preview launcher must detect a busy 5173 before serving');
  assert.ok(preview.includes('5173'),'preview launcher must keep port 5173 (the AI services only allow that origin)');
}
console.log(`PASS: C=${C.questions.length}, B=${B.sets.length}, categories=${categories.length}, phases and Schema 1.4.0 contract fixtures.`);
console.log('NOTE: No browser, recording, API, source authenticity or actual DOM rendering verification performed.');
