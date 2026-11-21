import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTranscriptionServer, DEFAULT_PORT, MODULE_VERSION } from '../src/http-server.mjs';

const AUDIO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('quiet-audio-payload')]);

function jsonResponse(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function formBody({ meta, audio = AUDIO, audioType = 'audio/webm;codecs=opus', filename = 'rec.webm', audioField = 'audio' } = {}) {
  const fd = new FormData();
  if (meta !== undefined) fd.append('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  if (audio !== null) fd.append(audioField, new Blob([audio], { type: audioType }), filename);
  return fd;
}

async function start(overrides = {}) {
  const lines = [];
  const server = createTranscriptionServer({ log: (l) => lines.push(JSON.stringify(l)), ...overrides });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const client = {
    port,
    lines,
    server,
    url: (path) => `http://127.0.0.1:${port}${path}`,
    async json(path, init = {}) {
      const res = await fetch(client.url(path), init);
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, body: safeJson(text) };
    },
    async post(payload, init = {}) {
      return client.json('/api/transcribe', { method: 'POST', body: payload, ...init });
    },
    raw: (options, payload) => rawRequest(port, options, payload),
    close: () => new Promise((resolve) => server.close(resolve))
  };
  return client;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Low-level request so we can control Content-Length and raw bytes. */
function rawRequest(port, { method = 'POST', path = '/api/transcribe', headers = {}, keepAlive = false }, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: keepAlive ? undefined : false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function okFetch(text = 'Good morning examiners.') {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return jsonResponse({ text }); };
  return { fn, calls };
}

const META = { examType: 'C', stage: 'speech', stageName: '个人陈述', sessionId: 's-7', questionId: 'c-speech-001', language: 'en', durationSeconds: 96, mimeType: 'audio/webm;codecs=opus' };

test('默认端口是 3002，与评分服务 3001 并存', () => {
  assert.equal(DEFAULT_PORT, 3002);
  assert.equal(MODULE_VERSION, '0.1.0');
});

test('/health 报告是否已配置 Key，但不泄露 Key', async () => {
  const client = await start({ apiKey: '' });
  try {
    const res = await client.json('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.keyConfigured, false);
    assert.equal(res.body.data.model, 'gpt-transcribe');
    assert.equal(res.body.data.moduleVersion, MODULE_VERSION);
    assert.deepEqual(res.body.data.allowedFormats.sort(), ['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm']);
    assert.equal(res.body.meta.demoOnly, false);

    const keyed = await start({ apiKey: 'sk-secret-value' });
    try {
      const second = await keyed.json('/health');
      assert.equal(second.body.data.keyConfigured, true);
      assert.equal(second.text.includes('sk-secret-value'), false);
    } finally { await keyed.close(); }
  } finally { await client.close(); }
});

test('成功转写返回信封结构，并原样回传 session 与 stage', async () => {
  const fetcher = okFetch(' hello world ');
  const client = await start({ apiKey: 'sk-x', fetchImpl: fetcher.fn });
  try {
    const res = await client.post(formBody({ meta: META }));
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.transcript, ' hello world ');
    assert.equal(res.body.data.empty, false);
    assert.equal(res.body.data.format, 'webm');
    assert.equal(res.body.data.bytesReceived, AUDIO.length);
    assert.deepEqual(res.body.meta, { sessionId: 's-7', stage: 'speech', stageName: '个人陈述', questionId: 'c-speech-001', demoOnly: false });
    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0].init.headers.Authorization.includes('sk-x'), true);
  } finally { await client.close(); }
});

test('静音音频返回 200 加空文本，而不是伪造内容', async () => {
  const client = await start({ apiKey: 'sk-x', fetchImpl: okFetch('').fn });
  try {
    const res = await client.post(formBody({ meta: META }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.transcript, '');
    assert.equal(res.body.data.empty, true);
  } finally { await client.close(); }
});

test('未配置 Key 时返回 503，且完全不出网', async () => {
  const fetcher = okFetch();
  const client = await start({ apiKey: '', fetchImpl: fetcher.fn });
  try {
    const res = await client.post(formBody({ meta: META }));
    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'API_KEY_MISSING');
    assert.equal(res.body.error.retryable, false);
    assert.equal(typeof res.body.data, 'undefined');
    assert.equal(fetcher.calls.length, 0);
  } finally { await client.close(); }
});

test('不支持的格式在出网前返回 415', async () => {
  const fetcher = okFetch();
  const client = await start({ apiKey: 'sk-x', fetchImpl: fetcher.fn });
  try {
    const res = await client.post(formBody({ meta: META, audioType: 'audio/3gpp', filename: 'rec.3gp' }));
    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_FORMAT');
    assert.equal(fetcher.calls.length, 0);
  } finally { await client.close(); }
});

test('缺音频 / 空音频 / 坏 meta 各自返回可辨认的 422', async () => {
  const client = await start({ apiKey: 'sk-x', fetchImpl: okFetch().fn });
  try {
    const missing = await client.post(formBody({ meta: META, audio: null }));
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.code, 'MISSING_AUDIO');

    const empty = await client.post(formBody({ meta: META, audio: Buffer.alloc(0) }));
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error.code, 'EMPTY_AUDIO');

    const broken = await client.post(formBody({ meta: '{not json', audio: AUDIO }));
    assert.equal(broken.status, 422);
    assert.equal(broken.body.error.code, 'INVALID_META');

    const noStage = await client.post(formBody({ meta: { sessionId: 1 } }));
    assert.equal(noStage.status, 422);
    assert.equal(noStage.body.error.code, 'INVALID_META');

    const badExam = await client.post(formBody({ meta: { ...META, examType: 'D' } }));
    assert.equal(badExam.status, 422);
    assert.equal(badExam.body.error.code, 'INVALID_META');

    const badLang = await client.post(formBody({ meta: { ...META, language: 'english only' } }));
    assert.equal(badLang.status, 422);
    assert.equal(badLang.body.error.code, 'INVALID_META');
  } finally { await client.close(); }
});

test('非 multipart 请求体返回 400', async () => {
  const client = await start({ apiKey: 'sk-x', fetchImpl: okFetch().fn });
  try {
    const res = await client.raw({ headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength('{}') } }, '{}');
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.text).error.code, 'INVALID_CONTENT_TYPE');
  } finally { await client.close(); }
});

test('超过上限的上传在读体阶段就被拒绝，不转给供应商', async () => {
  const fetcher = okFetch();
  const client = await start({ apiKey: 'sk-x', fetchImpl: fetcher.fn, maxBodyBytes: 256 });
  try {
    const huge = Buffer.alloc(4096, 0x61);
    const res = await client.raw({
      headers: { 'Content-Type': 'multipart/form-data; boundary=TOPEbig', 'Content-Length': String(huge.length) }
    }, `--TOPEbig\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n${huge.toString()}\r\n--TOPEbig--\r\n`);
    assert.equal(res.status, 413);
    assert.equal(JSON.parse(res.text).error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(fetcher.calls.length, 0);
  } finally { await client.close(); }
});

test('供应商故障按语义翻译为 502/504，并保留 retryable', async () => {
  const down = await start({ apiKey: 'sk-x', fetchImpl: () => jsonResponse('nope', 503) });
  try {
    const res = await down.post(formBody({ meta: META }));
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'PROVIDER_HTTP_ERROR');
    assert.equal(res.body.error.retryable, true);
  } finally { await down.close(); }

  const hang = await start({
    apiKey: 'sk-x',
    timeoutMs: 1000,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(jsonResponse({ text: 'late' })), 5000);
      init.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    })
  });
  try {
    const res = await hang.post(formBody({ meta: META }));
    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, 'PROVIDER_TIMEOUT');
    assert.equal(res.body.error.retryable, true);
  } finally { await hang.close(); }
});

test('跨域只放行前端预览端口', async () => {
  const client = await start({ apiKey: 'sk-x', fetchImpl: okFetch().fn });
  try {
    const allowed = await client.raw({ method: 'OPTIONS', path: '/api/transcribe', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');

    const denied = await client.raw({ method: 'OPTIONS', path: '/api/transcribe', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);

    const post = await client.post(formBody({ meta: META }), { headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(post.status, 200);
    assert.equal(post.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');

    const other = await client.post(formBody({ meta: META }), { headers: { Origin: 'https://evil.example' } });
    assert.equal(other.status, 200);
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  } finally { await client.close(); }
});

test('未知路径 404，方法不对 405', async () => {
  const client = await start({ apiKey: 'sk-x', fetchImpl: okFetch().fn });
  try {
    assert.equal((await client.json('/nope')).status, 404);
    assert.equal((await client.json('/api/transcribe')).status, 405);
    assert.equal((await client.raw({ method: 'POST', path: '/health', headers: { 'Content-Length': '0' } })).status, 405);
  } finally { await client.close(); }
});

test('日志只记元信息，不含转写文本与音频字节', async () => {
  const client = await start({ apiKey: 'sk-topsecret', fetchImpl: okFetch('this sentence must never be logged').fn });
  try {
    const res = await client.post(formBody({ meta: META }));
    assert.equal(res.status, 200);
    const dump = client.lines.join('\n');
    assert.equal(dump.includes('must never be logged'), false);
    assert.equal(dump.includes('sk-topsecret'), false);
    assert.equal(dump.includes('quiet-audio-payload'), false);
    const last = JSON.parse(client.lines[client.lines.length - 1]);
    assert.deepEqual(Object.keys(last).sort(), ['bytes', 'method', 'ms', 'path', 'status']);
    assert.equal(last.method, 'POST');
    assert.equal(last.path, '/api/transcribe');
    assert.equal(last.status, 200);
  } finally { await client.close(); }
});

test('鉴权头不出现在响应里', async () => {
  const client = await start({ apiKey: 'sk-leak-check', fetchImpl: okFetch().fn });
  try {
    const res = await client.post(formBody({ meta: META }));
    assert.equal(res.text.includes('sk-leak-check'), false);
    assert.equal(res.text.includes('Bearer'), false);
  } finally { await client.close(); }
});
