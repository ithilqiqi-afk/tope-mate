import test from 'node:test';
import assert from 'node:assert/strict';
import { audioFormatOf, DEFAULT_MODEL, PROVIDER_MAX_BYTES, PROVIDER_URL, TranscribeError, transcribeWithOpenAI } from '../src/provider.mjs';

const AUDIO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

function jsonResponse(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function captureFetch(responseFactory = () => jsonResponse({ text: 'hello there' })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, form: init.body });
    return responseFactory(url, init);
  };
  return { fn, calls };
}

function options(extra = {}) {
  return { apiKey: 'sk-test-key-do-not-log', fetchImpl: () => jsonResponse({ text: 'x' }), ...extra };
}

test('audioFormatOf 覆盖浏览器实际产出的 MIME 变体', () => {
  assert.deepEqual(audioFormatOf('audio/webm;codecs=opus'), { ext: 'webm', mime: 'audio/webm' });
  assert.deepEqual(audioFormatOf('video/webm'), { ext: 'webm', mime: 'audio/webm' });
  assert.deepEqual(audioFormatOf('audio/ogg;codecs=opus'), { ext: 'ogg', mime: 'audio/ogg' });
  assert.deepEqual(audioFormatOf('AUDIO/WAV'), { ext: 'wav', mime: 'audio/wav' });
  assert.deepEqual(audioFormatOf('audio/x-m4a'), { ext: 'm4a', mime: 'audio/mp4' });
  assert.deepEqual(audioFormatOf('audio/flac'), { ext: 'flac', mime: 'audio/flac' });
  assert.equal(audioFormatOf('audio/3gpp'), null);
  assert.equal(audioFormatOf(''), null);
  assert.equal(audioFormatOf(undefined), null);
});

test('调用真实形态：URL、鉴权头、复数 languages 与带扩展名的文件名', async () => {
  const { fn, calls } = captureFetch();
  const out = await transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm;codecs=opus', sessionId: 42 }, options({ fetchImpl: fn }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PROVIDER_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-key-do-not-log');
  const form = calls[0].form;
  assert.equal(form.get('model'), DEFAULT_MODEL);
  assert.equal(form.get('languages'), 'en');
  assert.equal(form.get('language'), null);
  assert.equal(form.get('response_format'), 'json');
  const file = form.get('file');
  assert.equal(file.name, 'tope-mate-42.webm');
  assert.equal(file.type, 'audio/webm');
  assert.deepEqual(out, { transcript: 'hello there', languages: [], model: DEFAULT_MODEL, bytes: AUDIO.length, format: 'webm' });
});

test('停用中的旧模型仍发送单数 language 字段', async () => {
  const { fn, calls } = captureFetch();
  await transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/wav', language: 'en-US' }, options({ fetchImpl: fn, model: 'whisper-1' }));
  const form = calls[0].form;
  assert.equal(form.get('language'), 'en-US');
  assert.equal(form.get('languages'), null);
  assert.equal(form.get('file').name, 'tope-mate-audio.wav');
});

test('gpt-transcribe 的语种检测结果原样返回，prompt 截断到 224', async () => {
  const { fn, calls } = captureFetch(() => jsonResponse({ text: 'ok', languages: [{ code: 'en' }, 'de', 7] }));
  const out = await transcribeWithOpenAI(
    { audio: AUDIO, mimeType: 'audio/flac', language: 'en', prompt: 'q'.repeat(400) },
    options({ fetchImpl: fn })
  );
  assert.deepEqual(out.languages, ['en', 'de']);
  assert.equal(calls[0].form.get('prompt').length, 224);
});

test('缺 Key 时立即失败，绝不伪造文本', async () => {
  const { fn, calls } = captureFetch();
  await assert.rejects(
    transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, { apiKey: '', fetchImpl: fn }),
    (err) => err instanceof TranscribeError && err.code === 'API_KEY_MISSING' && err.retryable === false
  );
  assert.equal(calls.length, 0);
});

test('空音频 / 不支持格式 / 超限音频都在出网前被拒绝', async () => {
  const { fn, calls } = captureFetch();
  const opts = options({ fetchImpl: fn });
  await assert.rejects(transcribeWithOpenAI({ audio: Buffer.alloc(0), mimeType: 'audio/webm' }, opts), { code: 'EMPTY_AUDIO' });
  await assert.rejects(transcribeWithOpenAI({ audio: 'not a buffer', mimeType: 'audio/webm' }, opts), { code: 'EMPTY_AUDIO' });
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/3gpp' }, opts), { code: 'UNSUPPORTED_FORMAT' });
  await assert.rejects(
    transcribeWithOpenAI({ audio: Buffer.alloc(PROVIDER_MAX_BYTES + 1), mimeType: 'audio/webm' }, opts),
    { code: 'AUDIO_TOO_LARGE' }
  );
  assert.equal(calls.length, 0);
});

test('供应商错误只带状态码，不回显请求内容', async () => {
  const { fn } = captureFetch(() => new Response('{"error":{"message":"Invalid model sk-secret"}}', { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: fn })),
    (err) => {
      assert.equal(err.code, 'PROVIDER_HTTP_ERROR');
      assert.equal(err.retryable, false);
      assert.equal(err.message.includes('400'), true);
      assert.equal(err.message.includes('sk-secret'), false);
      return true;
    }
  );
});

test('5xx 标记为可重试，网络中断与坏响应同样不产出文本', async () => {
  const five = captureFetch(() => new Response('boom', { status: 503 }));
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: five.fn })), (e) => e.code === 'PROVIDER_HTTP_ERROR' && e.retryable === true);

  const net = captureFetch(() => { throw new Error('socket hang up'); });
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: net.fn })), { code: 'PROVIDER_NETWORK_ERROR' });

  const bad = captureFetch(() => jsonResponse('not json at all'));
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: bad.fn })), { code: 'PROVIDER_BAD_RESPONSE' });

  const noText = captureFetch(() => jsonResponse({ language: 'en' }));
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: noText.fn })), { code: 'PROVIDER_BAD_RESPONSE' });
});

test('静音返回空字符串而不是编造内容，超时被翻译为 PROVIDER_TIMEOUT', async () => {
  const silent = captureFetch(() => jsonResponse({ text: '' }));
  const out = await transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: silent.fn }));
  assert.equal(out.transcript, '');

  const slow = async (url, init) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      });
    });
    return jsonResponse({ text: 'late' });
  };
  await assert.rejects(transcribeWithOpenAI({ audio: AUDIO, mimeType: 'audio/webm' }, options({ fetchImpl: slow, timeoutMs: 1000 })), { code: 'PROVIDER_TIMEOUT' });
});
