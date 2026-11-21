'use strict';
/* 前端服务层（转写 / 评分 / 流水线）的离线自动化测试。
   不需要浏览器、不需要 API Key、不产生任何付费调用：fetch、录音、下游服务都用桩件顶替，
   只验证四条硬规则：信封解析不出假数据、重复点击不多发请求、过期结果不覆盖新一轮、
   没有证据就不给分数也不给文本。
   运行：node tests/frontend-services.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
/* vm 里生成的数组和宿主数组原型不同，只比内容不比引用 */
const deepEqual = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), (msg || '内容不一致') + '，实际：' + JSON.stringify(a));

/* 把浏览器 IIFE 装进一个干净的 vm 里跑：只给它需要的全局，缺什么就是「没接入」 */
function loadService(file, globals) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const ctx = Object.assign({
    console, setTimeout, clearTimeout, FormData, Blob, AbortController, AbortSignal
  }, globals || {});
  ctx.window = ctx.window || {};
  vm.createContext(ctx);
  new vm.Script(src, { filename: file }).runInContext(ctx);
  return ctx;
}

const ok = (data, meta) => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ success: true, data, meta: meta || {} })) });const bad = (status, code, message, retryable) => ({ ok: false, status, text: () => Promise.resolve(JSON.stringify({ success: false, error: { code, message, retryable } })) });
const raw = (status, text) => ({ ok: status < 400, status, text: () => Promise.resolve(text) });
const audioBlob = new Blob(['webm-bytes'], { type: 'audio/webm' });

/* 记录每次 fetch 的桩：calls.length 就是「真实发出了几次请求」，handler 可在测试中途换 */
function fetchStub(handler) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => fn.handler(calls.length, url, init));
  };
  fn.calls = calls;
  fn.handler = handler;
  return fn;
}

const TRANSCRIBE_URL = 'http://127.0.0.1:3002/api/transcribe';
const EVALUATE_URL = 'http://127.0.0.1:3001/api/evaluate';

function transcribeCtx(handler, services) {
  const ctx = loadService('services/transcription.js', { fetch: handler });
  ctx.window.TOPE_CONFIG = { services: Object.assign({
    transcribeEndpoint: TRANSCRIBE_URL,
    healthEndpoints: { transcribe: 'http://127.0.0.1:3002/health' },
    maxAudioBytes: 1024,
    requestTimeoutMs: { transcribe: 5000 }
  }, services || {}) };
  return { ctx, T: ctx.window.TOPE_Transcription };
}

/* ─────────────────── 1. services/transcription.js ─────────────────── */
async function testTranscription() {
  /* 1.1 未配置：失败且没有任何文本，同时告诉用户接入位置 */
  const off = transcribeCtx(() => Promise.reject(new Error('不该发请求')), { transcribeEndpoint: '' });
  let r = await off.T.transcribe({ audioBlob, stage: 'speech' });
  assert.equal(r.success, false, '未配置时不能报成功');
  assert.equal(r.status, 'not_configured');
  assert.equal(r.transcript, '', '未配置时绝不能伪造文本');
  assert.match(r.message, /transcribeEndpoint/, '未配置信息要指出接入位置');

  /* 1.2 已配置但没有录音：明说缺音频，不发请求 */
  const f = fetchStub(() => Promise.resolve(ok({ transcript: 'x' })));
  const on = transcribeCtx(f);
  r = await on.T.transcribe({ stage: 'speech' });
  assert.equal(r.status, 'no_audio');
  assert.equal(r.code, 'MISSING_AUDIO');
  assert.equal(r.transcript, '');
  assert.equal(f.calls.length, 0, '没有录音不该发出请求');

  /* 1.3 超过大小上限：本地先拦，一个字节都不上传 */
  r = await on.T.transcribe({ audioBlob: new Blob(['x'.repeat(2048)], { type: 'audio/webm' }), stage: 'speech' });
  assert.equal(r.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(f.calls.length, 0, '超限录音不该发出请求');

  /* 1.4 正常转写：multipart 只有 audio + meta，没有密钥字段 */
  f.handler = () => Promise.resolve(ok(
    { transcript: 'Hello there.', language: 'en', model: 'gpt-transcribe', format: 'webm', bytesReceived: 10 },
    { sessionId: 's1', demoOnly: false }));
  r = await on.T.transcribe({ audioBlob, mimeType: 'audio/webm', durationSeconds: 12.4, sessionId: 's1', stage: 'speech', examType: 'C', questionId: 'C001' });
  assert.equal(r.success, true);
  assert.equal(r.status, 'ok');
  assert.equal(r.transcript, 'Hello there.');
  assert.equal(r.demoOnly, false);
  assert.equal(r.model, 'gpt-transcribe');
  const fd = f.calls[0].init.body;
  assert.ok(fd instanceof FormData, '转写要用 multipart 表单');
  assert.equal(fd.get('meta') && typeof fd.get('meta'), 'string');
  const meta = JSON.parse(fd.get('meta'));
  deepEqual(Object.keys(meta).sort(), ['durationSeconds', 'examType', 'language', 'mimeType', 'questionId', 'sessionId', 'stage', 'stageName']);
  assert.equal(meta.sessionId, 's1');
  assert.equal(meta.durationSeconds, 12);
  assert.equal(meta.language, 'en');
  for (const k of fd.keys()) assert.doesNotMatch(k.toLowerCase(), /key|token|secret/, '表单里不能出现密钥字段：' + k);

  /* 1.5 静音：空文本算「没听到语音」，不是一段可评分的转写 */
  f.handler = () => Promise.resolve(ok({ transcript: '   ' }, { sessionId: 's1' }));
  r = await on.T.transcribe({ audioBlob, stage: 'speech', sessionId: 's1' });
  assert.equal(r.success, true);
  assert.equal(r.status, 'no_speech');
  assert.equal(r.empty, true);

  /* 1.6 服务错误信封：错误码与可重试性原样透传，文本保持空 */
  f.handler = () => Promise.resolve(bad(504, 'PROVIDER_TIMEOUT', '上游超时', true));
  r = await on.T.transcribe({ audioBlob, stage: 'speech', sessionId: 's1' });
  assert.equal(r.code, 'PROVIDER_TIMEOUT');
  assert.equal(r.retryable, true);
  assert.equal(r.transcript, '');

  /* 1.7 轮次对不上：过期结果直接丢弃，不能带出文本 */
  f.handler = () => Promise.resolve(ok({ transcript: '属于上一轮' }, { sessionId: 'other-round' }));
  r = await on.T.transcribe({ audioBlob, stage: 'speech', sessionId: 's1' });
  assert.equal(r.status, 'stale');
  assert.equal(r.code, 'STALE_RESULT');
  assert.equal(r.transcript, '', '过期结果不能产出文本');

  /* 1.8 非 JSON 响应 */
  f.handler = () => Promise.resolve(raw(200, '<html>不是 JSON</html>'));
  r = await on.T.transcribe({ audioBlob, stage: 'speech', sessionId: 's1' });
  assert.equal(r.code, 'BAD_RESPONSE');
  assert.equal(r.transcript, '');

  /* 1.9 连不上服务 */
  f.handler = () => Promise.reject(new Error('fetch failed'));
  r = await on.T.transcribe({ audioBlob, stage: 'speech', sessionId: 's1' });
  assert.equal(r.code, 'NETWORK_ERROR');
  assert.equal(r.retryable, true);
  assert.match(r.message, /npm run serve/);

  /* 1.10 health 探测：不在线要说清，不上传任何字节 */
  f.handler = () => Promise.resolve(ok({ status: 'ok', keyConfigured: false, model: 'gpt-transcribe' }));
  const h = await on.T.health();
  assert.equal(h.online, true);
  assert.equal(h.keyConfigured, false, '没有 Key 时必须报出来，页面据此说明结果不是模型评分');
  const lastCall = f.calls[f.calls.length - 1];
  assert.equal(lastCall.init.method, 'GET', '健康检查只用 GET');
  assert.equal(lastCall.init.body, undefined, '健康检查不上传任何音频');
  console.log('  · services/transcription.js：10 项通过');
}

/* ─────────────────── 2. services/evaluation.js ─────────────────── */
function evalCtx(handler, services) {
  const ctx = loadService('services/evaluation.js', { fetch: handler });
  ctx.window.TOPE_CONFIG = {
    services: Object.assign({ evaluateEndpoint: EVALUATE_URL, requestTimeoutMs: { evaluate: 5000 } }, services || {}),
    scoringStages: { intro: 'self_intro', presentation: 'statement', discussion: 'discussion', speech: 'speech', qa: 'qa' },
    scoring: { rubric: 'ruc_tope_official_bands_v1', language: 'en', dimensionLabels: { relevance: '切题与内容', interaction: '互动能力' } }
  };
  return { ctx, E: ctx.window.TOPE_Evaluation };
}

/* 一份最小但合法的 1.4.0 报告，故意把 interaction / timeManagement 留成 null */
function report140(over) {
  return Object.assign({
    schemaVersion: '1.4.0', mode: 'ai', examType: 'C', stage: 'speech',
    practiceScore: 80, scoreVersion: 'practice_index_v1.0.0', scoreStatus: 'partial',
    scorePolicy: { configuredWeights: { relevance: 30, interaction: 25 } },
    scoreCoverage: { assessedDimensions: ['relevance'], coveragePercent: 55 },
    overall: { score: 80, label: 'practice_reference', disclaimer: '练习参考分，不是官方成绩。' },
    officialAssessment: { level: null, status: 'not_predicted' },
    scores: { relevance: 80, organization: null, development: null, language: null, interaction: null, taskCompletion: null, timeManagement: null },
    dimensionFeedback: [{ dimension: 'relevance', normalizedWeight: 100, rationale: '开头点题清楚。', evidenceQuotes: ['I believe universities should'] }],
    strengths: ['切题'], weaknesses: [], suggestions: [], evidence: [], peel: null, peelDetails: null,
    improvedExpressions: [{ original: 'a lot of', suggested: 'many', reason: '更书面' }],
    nextPractice: [], unassessed: ['pronunciation', 'prosody', 'audio_fluency'], diagnostics: null, errors: []
  }, over || {});
}

async function testEvaluation() {
  /* 2.1 阶段映射：A 内部键 → Schema stage；prepare 没有口头产出不许评分 */
  const base = evalCtx(() => Promise.reject(new Error('不该发请求')));
  const E = base.E;
  assert.equal(E.stageKey('C', 'speech'), 'speech');
  assert.equal(E.stageKey('C', 'qa'), 'qa');
  assert.equal(E.stageKey('B', 'intro'), 'self_intro');
  assert.equal(E.stageKey('B', 'presentation'), 'statement');
  assert.equal(E.stageKey('B', 'discussion'), 'discussion');
  assert.equal(E.stageKey('C', 'prepare'), null, 'prepare 不该映射到任何评分阶段');
  assert.equal(E.stageKey('C', 'discussion'), null, 'C 考不该用 B 的阶段');

  /* 2.2 请求体：只有文本，没有任何音频字段；互动维度只认真实轮次 */
  const req = E.buildRequest({ examType: 'C', phaseKey: 'speech', question: 'Talk about X.', transcript: '  real words  ', durationSeconds: 176.44, targetDurationSeconds: 180.6, questionId: 'C001' });
  deepEqual(Object.keys(req).sort(), ['durationSeconds', 'examType', 'question', 'questionId', 'rubric', 'stage', 'targetDurationSeconds', 'transcript']);
  for (const k of ['audio', 'audioBase64', 'blob', 'recording']) assert.ok(!(k in req), '评分请求不能带音频字段：' + k);
  assert.equal(req.durationSeconds, 176.4);
  assert.equal(req.targetDurationSeconds, 181);
  assert.equal(req.rubric, 'ruc_tope_official_bands_v1');
  const noTurns = E.buildRequest({ examType: 'B', phaseKey: 'discussion', question: 'Q', transcript: 'T' });
  assert.ok(!('speakerTurns' in noTurns) && !('assessedSpeaker' in noTurns), '没有真实说话人轮次时不能伪造互动证据');
  const withTurns = E.buildRequest({
    examType: 'B', phaseKey: 'discussion', question: 'Q', transcript: 'T', assessedSpeaker: 'A',
    speakerTurns: [{ speaker: 'A', text: 'mine' }, { speaker: 'B', text: 'peer' }, { speaker: 'A', text: '   ' }]
  });
  assert.equal(withTurns.speakerTurns.length, 2, '空轮次要过滤掉');
  assert.equal(withTurns.assessedSpeaker, 'A');

  /* 2.3 本地拦截：超长文本、缺题目、阶段映射不到都不该发请求 */
  const f = fetchStub(() => Promise.resolve(ok(report140())));
  const on = evalCtx(f);
  let r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'x'.repeat(30001) });
  assert.equal(r.code, 'TRANSCRIPT_TOO_LONG');
  assert.equal(f.calls.length, 0, '超长文本不该发请求');
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', transcript: 'T' });
  assert.equal(r.code, 'MISSING_QUESTION');
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'prepare', question: 'Q', transcript: 'T' });
  assert.equal(r.code, 'UNMAPPED_STAGE');
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: '   ' });
  assert.equal(r.code, 'EMPTY_TRANSCRIPT');
  assert.equal(r.retryable, false);
  assert.equal(f.calls.length, 0, '校验不过的请求一个都没发出去');

  /* 2.4 正常报告：null 分数保持 null，权重与依据分别来自 scorePolicy / dimensionFeedback */
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'real words', durationSeconds: 176, sessionId: 's1' });
  assert.equal(r.success, true);
  assert.equal(r.contractVersion, '1.4.0');
  assert.equal(r.practiceScore, 80);
  const rel = r.dimensions.find((d) => d.key === 'relevance');
  assert.equal(rel.label, '切题与内容');
  assert.equal(rel.score, 80);
  assert.equal(rel.weight, 30);
  assert.equal(rel.normalizedWeight, 100);
  assert.equal(rel.rationale, '开头点题清楚。');
  deepEqual(rel.evidenceQuotes, ['I believe universities should']);
  const inter = r.dimensions.find((d) => d.key === 'interaction');
  assert.equal(inter.score, null, '未评估维度必须是 null，不能补 0');
  assert.equal(inter.assessed, false);
  deepEqual(r.unassessed, ['pronunciation', 'prosody', 'audio_fluency']);
  assert.equal(JSON.parse(f.calls[0].init.body).transcript, 'real words');
  assert.ok(!('audio' in JSON.parse(f.calls[0].init.body)));

  /* 2.5 契约不符：版本不对 / 预测官方等级 / 分数越界，一律不采用 */
  f.handler = () => Promise.resolve(ok(report140({ schemaVersion: '1.3.0' })));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.success, false);
  assert.equal(r.code, 'SCHEMA_VERSION_MISMATCH');
  f.handler = () => Promise.resolve(ok(report140({ officialAssessment: { level: 4 } })));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.code, 'OFFICIAL_LEVEL_PREDICTED', '返回官方等级预测必须整份拒绝');
  f.handler = () => Promise.resolve(ok(report140({ practiceScore: 4000 })));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.code, 'BAD_PRACTICE_SCORE');
  f.handler = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"success":true}') });
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.code, 'MISSING_DATA');
  f.handler = () => Promise.resolve(raw(200, '不是 JSON'));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.status, 'service');

  /* 2.6 heuristic / 未配置：明确离线，不产出练习分 */
  f.handler = () => Promise.resolve(ok(report140({ mode: 'heuristic', practiceScore: null, scoreStatus: 'not_scored', overall: { score: null, label: 'not_scored' } })));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.success, true);
  assert.equal(r.mode, 'heuristic');
  assert.equal(r.practiceScore, null, '离线启发式不能带分数');
  const off2 = evalCtx(() => Promise.reject(new Error('不该发请求')), { evaluateEndpoint: '' });
  r = await off2.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.code, 'NOT_CONFIGURED');
  assert.match(r.message, /evaluateEndpoint/);

  /* 2.7 服务错误码 → 状态与可重试性 */
  f.handler = () => Promise.resolve(bad(503, 'API_KEY_MISSING', '服务端没有 Key', false));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.status, 'no_key');
  assert.equal(r.retryable, false);
  f.handler = () => Promise.resolve(bad(502, 'PROVIDER_HTTP_ERROR', '上游 500', true));
  r = await on.E.evaluate({ examType: 'C', phaseKey: 'speech', question: 'Q', transcript: 'T' });
  assert.equal(r.status, 'provider');
  assert.equal(r.retryable, true);
  console.log('  · services/evaluation.js：7 组断言通过');
}

/* ─────────────────── 3. services/ai-pipeline.js ─────────────────── */
/* 流水线只管编排，这里把转写/评分/录音都换成可控桩，验证防重复、防过期、原始与编辑分开。 */
function pipelineCtx(opts) {
  const o = opts || {};
  const ctx = loadService('services/ai-pipeline.js', {});
  const w = ctx.window;
  w.TOPE_CONFIG = { scoring: { language: 'en' } };
  w.TOPE_Evaluation = { stageKey: (examType, key) => ({ speech: 'speech', qa: 'qa', intro: 'self_intro', presentation: 'statement', discussion: 'discussion' })[key] || null };
  const recordings = o.recordings || {};
  w.TOPE_Recorder = { get: (key) => recordings[key] || null };
  const log = { transcribe: [], evaluate: [], concurrent: 0, maxConcurrent: 0 };
  w.TOPE_Transcription = {
    transcribe: (payload) => {
      log.transcribe.push(payload);
      log.concurrent++; log.maxConcurrent = Math.max(log.maxConcurrent, log.concurrent);
      return (o.transcribe ? o.transcribe(payload) : Promise.resolve({ success: true, transcript: 'raw text of ' + payload.stage, model: 'gpt-transcribe', format: 'webm', bytesReceived: 10 }))
        .then((v) => { log.concurrent--; return v; }, (e) => { log.concurrent--; throw e; });
    }
  };
  w.TOPE_Evaluation.evaluate = (payload) => {
    log.evaluate.push(payload);
    log.concurrent++; log.maxConcurrent = Math.max(log.maxConcurrent, log.concurrent);
    return (o.evaluate ? o.evaluate(payload) : Promise.resolve({ success: true, practiceScore: 77, mode: 'ai' }))
      .then((v) => { log.concurrent--; return v; }, (e) => { log.concurrent--; throw e; });
  };
  return { P: w.TOPE_Pipeline, log };
}

const twoPhase = (sessionId) => ({
  sessionId: sessionId,
  examType: 'C',
  phases: [
    { key: 'speech', name: '3 分钟演讲', question: 'Talk about X.', questionId: 'C001:speech', targetDurationSeconds: 180 },
    { key: 'qa', name: '问答环节', question: 'Why do you think so?', questionId: 'C001:qa' }
  ]
});
const rec = (complete) => ({ blob: new Blob(['x'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationSeconds: 12, complete: complete !== false });

async function testPipeline() {
  /* 3.1 begin：每阶段一条独立状态，阶段键映射正确，不发任何请求 */
  const a = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) } });
  let states = a.P.begin(twoPhase('round-1'));
  let s;
  assert.equal(states.length, 2);
  deepEqual(states.map((s) => s.status), ['idle', 'idle']);
  assert.equal(states[0].stage, 'speech');
  assert.equal(states[0].statusText, '未开始分析');
  assert.equal(a.log.transcribe.length + a.log.evaluate.length, 0, 'begin 不该产生调用');

  /* 3.2 重复点击复用在途请求：两次 transcribe 只发一次 */
  let release;
  const hold = new Promise((res) => { release = res; });
  const b = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) }, transcribe: () => hold });
  b.P.begin(twoPhase('round-2'));
  const p1 = b.P.transcribe('speech');
  const p2 = b.P.transcribe('speech');
  assert.equal(p1, p2, '同一阶段的重复点击必须复用同一个在途 Promise');
  assert.equal(b.log.transcribe.length, 1, '重复点击不能打出第二次上传');
  assert.equal(b.P.get('speech').status, 'transcribing');
  release({ success: true, transcript: 'hello', model: 'm', format: 'webm', bytesReceived: 5 });
  s = await p1;
  assert.equal(s.status, 'transcribed');
  assert.equal(s.original, 'hello');
  assert.equal(b.log.transcribe.length, 1);

  /* 3.3 新一轮 begin 后，旧轮晚到的响应不能覆盖结果 */
  let releaseLate;
  const late = new Promise((res) => { releaseLate = res; });
  const c = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) }, transcribe: () => late });
  c.P.begin(twoPhase('round-3'));
  const stale = c.P.transcribe('speech');
  c.P.begin(twoPhase('round-3-b'));
  releaseLate({ success: true, transcript: '晚到的旧结果' });
  await stale;
  assert.equal(c.P.get('speech').original, '', '过期响应不能写进新一轮');
  assert.equal(c.P.get('speech').status, 'idle');

  /* 3.4 没有录音 / 静音：标成证据不足，绝不提交评分 */
  const d = pipelineCtx({ recordings: { speech: rec(true) }, transcribe: () => Promise.resolve({ success: true, transcript: '   ', model: 'm', format: 'webm', bytesReceived: 1 }) });
  d.P.begin(twoPhase('round-4'));
  s = await d.P.transcribe('speech');
  assert.equal(s.status, 'no_evidence');
  assert.equal(s.error.code, 'NO_SPEECH');
  s = await d.P.transcribe('qa');
  assert.equal(s.status, 'no_evidence');
  assert.equal(s.error.code, 'MISSING_AUDIO');
  await d.P.score('speech');
  assert.equal(d.log.evaluate.length, 0, '空文本不能提交评分');

  /* 3.5 手动补文本：原始转写保持不动，来源标记随之改变 */
  const e = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) } });
  e.P.begin(twoPhase('round-5'));
  s = await e.P.transcribe('speech');
  assert.equal(s.transcriptSource, 'original');
  e.P.setTranscript('speech', 'edited text');
  assert.equal(e.P.get('speech').original, 'raw text of speech', '用户改文本不能覆盖原始转写');
  assert.equal(e.P.get('speech').transcriptSource, 'edited');
  assert.equal(e.P.effectiveTranscript('speech'), 'edited text');
  s = await e.P.score('speech');
  assert.equal(s.status, 'done');
  assert.equal(e.log.evaluate[0].transcript, 'edited text', '评分要用用户确认后的文本');
  assert.equal(s.report.usedTranscript, 'edited text');
  assert.equal(s.report.transcriptSource, 'edited');
  e.P.setTranscript('speech', 'raw text of speech');
  assert.equal(e.P.get('speech').transcriptSource, 'original', '改回原文后来源要回到 original');

  /* 3.6 未确认完整的录音：默认不提交评分，用户明确同意后才发 */
  const g = pipelineCtx({ recordings: { speech: { blob: new Blob(['x'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationSeconds: 12, complete: false }, qa: rec(true) } });
  g.P.begin(twoPhase('round-6'));
  await g.P.transcribe('speech');
  s = await g.P.score('speech');
  assert.equal(s.status, 'no_evidence');
  assert.equal(s.error.code, 'INCOMPLETE_RECORDING');
  assert.equal(g.log.evaluate.length, 0, '没确认完整的录音不能偷偷提交');
  g.P.confirmIncomplete('speech');
  s = await g.P.score('speech');
  assert.equal(s.status, 'done');
  assert.equal(s.report.recordingComplete, false, '报告要如实记下这是未确认完整的录音');

  /* 3.7 cancel：进行中的阶段回退，已有文本的回「转写成功」，已完成的报告保留 */
  let relScore;
  const holdScore = new Promise((res) => { relScore = res; });
  const h = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) }, evaluate: () => holdScore });
  h.P.begin(twoPhase('round-7'));
  await h.P.transcribe('speech');
  await h.P.transcribe('qa');
  h.P.score('speech');
  assert.equal(h.P.get('speech').status, 'scoring');
  h.P.cancel('用户点了停止');
  relScore({ success: true, practiceScore: 90, mode: 'ai' });
  assert.equal(h.P.get('speech').status, 'transcribed', '取消后回到「转写成功」，等用户重新点评分');
  assert.equal(h.P.get('speech').error.code, 'CANCELLED');
  assert.equal(h.P.get('speech').report, null, '被取消的请求不能落下一份报告');
  assert.equal(h.P.busy(), false);
  const keep = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) } });
  keep.P.begin(twoPhase('round-8'));
  await keep.P.transcribe('speech');
  await keep.P.score('speech');
  keep.P.cancel('离开报告页');
  assert.equal(keep.P.get('speech').status, 'done', '离开页面不能把已经拿到的报告丢掉');
  assert.equal(keep.P.get('speech').report.practiceScore, 77);

  /* 3.8 analyzeAll：一次只发一个请求，串行跑完两个阶段 */
  const i = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) } });
  i.P.begin(twoPhase('round-10'));
  await i.P.analyzeAll();
  assert.equal(i.log.maxConcurrent, 1, '并发必须为 1，避免同时打出多份付费调用');
  deepEqual(i.log.transcribe.map((p) => p.stage), ['speech', 'qa']);
  deepEqual(i.log.evaluate.map((p) => p.stage), ['speech', 'qa']);
  deepEqual(i.P.states().map((s) => s.status), ['done', 'done']);
  assert.equal(i.P.states()[0].busy, false);

  /* 3.9 失败可重试：错误里带 retryable，重试真的再发一次 */
  let first = true;
  const j = pipelineCtx({
    recordings: { speech: rec(true), qa: rec(true) },
    evaluate: () => {
      if (first) { first = false; return Promise.resolve({ success: false, code: 'PROVIDER_TIMEOUT', message: '评分服务超时', retryable: true }); }
      return Promise.resolve({ success: true, practiceScore: 71, mode: 'ai' });
    }
  });
  j.P.begin(twoPhase('round-11'));
  await j.P.transcribe('speech');
  s = await j.P.score('speech');
  assert.equal(s.status, 'failed');
  assert.equal(s.error.retryable, true);
  s = await j.P.score('speech');
  assert.equal(s.status, 'done');
  assert.equal(j.log.evaluate.length, 2, '重试才该发第二次请求');
  assert.equal(s.attempts, 3, 'attempts 数的是这一阶段的真实请求次数：1 次转写 + 2 次评分');

  /* 3.10 评分流程异常也不会留下「正在评分」的假状态 */
  const k = pipelineCtx({ recordings: { speech: rec(true), qa: rec(true) }, transcribe: () => Promise.resolve({ success: true, transcript: 't', model: 'm', format: 'webm', bytesReceived: 1 }), evaluate: () => Promise.reject(new Error('boom')) });
  k.P.begin(twoPhase('round-12'));
  await k.P.transcribe('speech');
  s = await k.P.score('speech');
  assert.equal(s.status, 'failed');
  assert.equal(s.error.code, 'UNEXPECTED');
  console.log('  · services/ai-pipeline.js：10 组编排规则通过');
}

(async function main() {
  await testTranscription();
  await testEvaluation();
  await testPipeline();
  console.log('PASS: 前端转写/评分/流水线服务层离线测试全部通过（无浏览器、无 API Key、无付费调用）。');
  console.log('NOTE: 真实转写服务与真实模型的联网行为尚未在本机验证，需要使用者提供 Key 后另行测试。');
})().catch((err) => {
  console.error('FAIL:', err && err.stack || err);
  process.exit(1);
});
