import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { boundaryOf, parseMultipart, MultipartError } from './multipart.mjs';
import { audioFormatOf, transcribeWithOpenAI, TranscribeError, DEFAULT_MODEL, PROVIDER_MAX_BYTES, SUPPORTED_AUDIO } from './provider.mjs';
import { transcribeWithBailian, BAILIAN_ASR_MODEL, BAILIAN_ASR_FORMATS, BAILIAN_MAX_RAW_BYTES, BAILIAN_MAX_AUDIO_SECONDS } from './bailian-provider.mjs';

export const MODULE_VERSION = '0.1.0';
export const CONTRACT_VERSION = 'transcribe_v1';
export const DEFAULT_PORT = 3002;
export const PROVIDERS = new Set(['openai', 'bailian']);
/** Browser recordings are Opus in WebM; 5 minutes is well under a megabyte. */
export const DEFAULT_MAX_BODY_BYTES = 12 * 1024 * 1024;
/** A MediaRecorder upload has to arrive inside this window or the request is dropped. */
export const UPLOAD_TIMEOUT_MS = 60000;
export const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

/** 供应商只换传输层；契约版本、信封字段与「不保存录音」的行为两条通路完全一致。 */
export function resolveProvider(value) {
  const name = String(value || 'openai').trim().toLowerCase();
  if (!PROVIDERS.has(name)) throw new RangeError(`Unsupported TRANSCRIBE_PROVIDER: ${value}`);
  return name;
}

const ERROR_TABLE = {
  INVALID_CONTENT_TYPE: { status: 400, message: '请求必须使用 multipart/form-data 提交音频。', retryable: false },
  MALFORMED_MULTIPART: { status: 400, message: '上传内容不是合法的 multipart 表单，请重试。', retryable: true },
  METHOD_NOT_ALLOWED: { status: 405, message: '该路径不支持此 HTTP 方法。', retryable: false },
  NOT_FOUND: { status: 404, message: '接口不存在。', retryable: false },
  CORS_FORBIDDEN: { status: 403, message: '该来源不被允许跨域访问。', retryable: false },
  BODY_TIMEOUT: { status: 408, message: '上传超时，请重新提交录音。', retryable: true },
  PAYLOAD_TOO_LARGE: { status: 413, message: '录音体积超过转写服务的上传上限，请缩短这一阶段或分段练习。', retryable: false },
  UNSUPPORTED_FORMAT: { status: 415, message: '这种音频格式暂不被转写服务支持，请下载录音后用其他格式重试。', retryable: false },
  MISSING_AUDIO: { status: 422, message: '请求里没有音频文件，无法转写。', retryable: false },
  EMPTY_AUDIO: { status: 422, message: '收到的音频是空的，请重新录音。', retryable: false },
  INVALID_META: { status: 422, message: '请求附带的阶段信息不合法，请刷新页面后重试。', retryable: false },
  AUDIO_TOO_LARGE: { status: 413, message: '录音超过转写供应商的单文件上限。', retryable: false },
  AUDIO_TOO_LONG: { status: 413, message: '这段录音超过转写模型单次 5 分钟的上限，请分段练习后重试，服务不会截断音频。', retryable: false },
  PROVIDER_CONFIG_ERROR: { status: 503, message: '百炼服务地址或接口不可用：默认地址 https://dashscope.aliyuncs.com/compatible-mode/v1 已验证可用于兼容模式；若自行填写 BAILIAN_BASE_URL，请把 {WorkspaceId} 换成控制台里的真实业务空间 ID。', retryable: false },
  API_KEY_MISSING: { status: 503, message: '服务器尚未配置语音转写所需的 API Key，无法生成转写文本。', retryable: false },
  FETCH_UNAVAILABLE: { status: 503, message: '服务器运行环境不支持调用转写服务，请使用 Node.js 18+。', retryable: false },
  PROVIDER_AUTH_ERROR: { status: 503, message: '百炼鉴权或业务空间调用权限校验未通过：请确认 API Key 有效、与地域匹配，且该业务空间已开通所用模型。', retryable: false },
  PROVIDER_MODEL_UNAVAILABLE: { status: 502, message: '所用转写模型在当前业务空间或地域不可用：请核对模型 ID 与业务空间权限，不要自行切换地域或开通付费服务。', retryable: false },
  PROVIDER_HTTP_ERROR: { status: 502, message: '转写服务暂时不可用，请稍后重试。', retryable: true },
  PROVIDER_NETWORK_ERROR: { status: 502, message: '转写服务连接失败，请检查网络后重试。', retryable: true },
  PROVIDER_BAD_RESPONSE: { status: 502, message: '转写服务返回了无法解析的结果，本次不生成转写文本。', retryable: true },
  PROVIDER_TIMEOUT: { status: 504, message: '转写服务响应超时，请稍后重试。', retryable: true },
  INTERNAL_ERROR: { status: 500, message: '转写服务内部错误，请稍后重试。', retryable: false }
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req) });
  res.end(JSON.stringify(payload));
}

function sendError(req, res, code, overrideMessage) {
  const entry = ERROR_TABLE[code] || ERROR_TABLE.INTERNAL_ERROR;
  sendJson(req, res, entry.status, { success: false, error: { code: ERROR_TABLE[code] ? code : 'INTERNAL_ERROR', message: overrideMessage || entry.message, retryable: entry.retryable } });
}

/** Read the whole request body, refusing anything that outruns the configured cap. */
function readBody(req, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      return reject(Object.assign(new Error('too large'), { code: 'PAYLOAD_TOO_LARGE' }));
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(Object.assign(new Error('upload timeout'), { code: 'BODY_TIMEOUT' })), timeoutMs);
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) return fail(Object.assign(new Error('too large'), { code: 'PAYLOAD_TOO_LARGE' }));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(Object.assign(err, { code: err.code || 'MALFORMED_MULTIPART' })));
  });
}

function shortString(value, max, label) {
  if (typeof value !== 'string') throw new TranscribeError('INVALID_META', `${label} 必须是字符串。`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new TranscribeError('INVALID_META', `${label} 长度不合法。`);
  return trimmed;
}

/**
 * `meta` is whatever the browser attached to the upload. The server never scores
 * anything: it only needs enough to bind the transcript back to the right session
 * and stage, plus the language hint. Everything is length-capped before use.
 */
function parseMeta(rawMeta) {
  let meta;
  try {
    meta = typeof rawMeta === 'string' && rawMeta.trim() ? JSON.parse(rawMeta) : {};
  } catch {
    throw new TranscribeError('INVALID_META', '阶段信息不是合法 JSON。');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new TranscribeError('INVALID_META', '阶段信息必须是一个对象。');
  }
  const language = meta.language === undefined || meta.language === null ? 'en' : shortString(String(meta.language), 12, 'language').toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})*$/i.test(language)) throw new TranscribeError('INVALID_META', 'language 不是合法的语种代码。');
  const out = {
    /* Correlation only. A stale or forged value can at worst mislabel a transcript
       that the browser-side pipeline re-checks against the live session before use. */
    sessionId: meta.sessionId === undefined || meta.sessionId === null ? null : shortString(String(meta.sessionId), 64, 'sessionId'),
    stage: shortString(String(meta.stage || ''), 40, 'stage'),
    stageName: meta.stageName === undefined || meta.stageName === null ? null : shortString(String(meta.stageName), 80, 'stageName'),
    examType: meta.examType === undefined || meta.examType === null ? null : shortString(String(meta.examType).toUpperCase(), 4, 'examType'),
    language,
    questionId: meta.questionId === undefined || meta.questionId === null ? null : shortString(String(meta.questionId), 128, 'questionId'),
    mimeType: meta.mimeType === undefined || meta.mimeType === null ? null : shortString(String(meta.mimeType), 80, 'mimeType').toLowerCase()
  };
  if (out.examType && !['B', 'C'].includes(out.examType)) throw new TranscribeError('INVALID_META', 'examType 只能是 B 或 C。');
  if (typeof meta.durationSeconds === 'number' && Number.isFinite(meta.durationSeconds)) {
    if (meta.durationSeconds < 0 || meta.durationSeconds > 3600) throw new TranscribeError('INVALID_META', 'durationSeconds 超出范围。');
    out.durationSeconds = Math.round(meta.durationSeconds);
  }
  return out;
}

export function createTranscriptionServer({
  provider = process.env.TRANSCRIBE_PROVIDER || 'openai',
  apiKey = process.env.OPENAI_API_KEY,
  bailianApiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
  model = process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
  bailianModel = process.env.BAILIAN_ASR_MODEL || BAILIAN_ASR_MODEL,
  bailianBaseUrl = process.env.BAILIAN_BASE_URL,
  bailianEnableItn = /^(1|true|yes)$/i.test(process.env.BAILIAN_ASR_ENABLE_ITN || ''),
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.TRANSCRIBE_TIMEOUT_MS || 90000),
  maxBodyBytes = Number(process.env.MAX_AUDIO_BYTES || DEFAULT_MAX_BODY_BYTES),
  prompt = process.env.TRANSCRIBE_PROMPT || '',
  log = defaultLog
} = {}) {
  const activeProvider = resolveProvider(provider);
  // 两个供应商的密钥互不回退，OpenAI 的 Key 绝不会被发给阿里云，反之也一样。
  const activeKey = activeProvider === 'bailian' ? bailianApiKey : apiKey;
  const activeModel = activeProvider === 'bailian' ? bailianModel : model;
  /* 百炼的上限按「Base64 编码后 ≤10 MB」折算到原始字节，收进来就拒，不做截断。 */
  const providerCeiling = activeProvider === 'bailian' ? BAILIAN_MAX_RAW_BYTES : PROVIDER_MAX_BYTES;
  const cap = Number.isFinite(maxBodyBytes) && maxBodyBytes > 0 ? Math.min(maxBodyBytes, providerCeiling) : DEFAULT_MAX_BODY_BYTES;

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const path = (req.url || '').split('?')[0];
    let status = 500;
    try {
      if (req.method === 'OPTIONS') {
        const headers = corsHeaders(req);
        if (headers['Access-Control-Allow-Origin']) {
          status = 204;
          res.writeHead(204, headers);
          res.end();
        } else {
          status = 403;
          sendError(req, res, 'CORS_FORBIDDEN');
        }
        return;
      }

      if (path === '/health' && req.method === 'GET') {
        status = 200;
        sendJson(req, res, 200, {
          success: true,
          data: {
            status: 'ok',
            contract: CONTRACT_VERSION,
            moduleVersion: MODULE_VERSION,
            provider: activeProvider,
            model: activeModel,
            keyConfigured: Boolean(activeKey),
            /* 真实调用可能慢于预期，健康检查如实报告生效超时，便于联网前核对。 */
            timeoutMs,
            maxAudioBytes: cap,
            /* 百炼模型另有单次时长上限；openai 通路不声明该限制。 */
            maxAudioSeconds: activeProvider === 'bailian' ? BAILIAN_MAX_AUDIO_SECONDS : null,
            allowedFormats: activeProvider === 'bailian' ? Object.keys(BAILIAN_ASR_FORMATS) : Object.keys(SUPPORTED_AUDIO)
          },
          meta: { demoOnly: false }
        });
        return;
      }

      if (path === '/api/transcribe' && req.method === 'POST') {
        const boundary = boundaryOf(req.headers['content-type']);
        if (!boundary) { status = 400; return sendError(req, res, 'INVALID_CONTENT_TYPE'); }

        let raw;
        try {
          raw = await readBody(req, cap, UPLOAD_TIMEOUT_MS);
        } catch (err) {
          status = (ERROR_TABLE[err.code] || ERROR_TABLE.MALFORMED_MULTIPART).status;
          return sendError(req, res, err.code || 'MALFORMED_MULTIPART');
        }

        let parts;
        try {
          parts = parseMultipart(raw, boundary).parts;
        } catch (err) {
          status = err instanceof MultipartError ? 400 : 500;
          return sendError(req, res, err instanceof MultipartError ? err.code : 'INTERNAL_ERROR');
        }

        const named = parts.find(p => p.data && (p.name === 'audio' || p.name === 'file'));
        const filePart = named || parts.find(p => p.data && p.filename !== null);
        const metaPart = parts.find(p => p.name === 'meta');
        if (!filePart || !filePart.data || filePart.data.length === 0) {
          status = 422;
          return sendError(req, res, filePart ? 'EMPTY_AUDIO' : 'MISSING_AUDIO');
        }

        let meta;
        try {
          meta = parseMeta(metaPart ? metaPart.value : '');
        } catch (err) {
          status = 422;
          return sendError(req, res, 'INVALID_META', err.message);
        }

        const mimeType = filePart.contentType || filePart.mime || meta.mimeType;
        if (!audioFormatOf(mimeType)) {
          status = 415;
          return sendError(req, res, 'UNSUPPORTED_FORMAT');
        }

        const result = activeProvider === 'bailian'
          ? await transcribeWithBailian(
              { audio: filePart.data, mimeType, language: meta.language, durationSeconds: meta.durationSeconds === undefined ? null : meta.durationSeconds },
              { apiKey: activeKey, model: activeModel, baseUrl: bailianBaseUrl, fetchImpl, timeoutMs, enableItn: bailianEnableItn }
            )
          : await transcribeWithOpenAI(
              { audio: filePart.data, mimeType, language: meta.language, prompt, sessionId: meta.sessionId },
              { apiKey: activeKey, model: activeModel, fetchImpl, timeoutMs }
            );

        status = 200;
        sendJson(req, res, 200, {
          success: true,
          data: {
            contract: CONTRACT_VERSION,
            transcript: result.transcript,
            language: meta.language,
            detectedLanguages: result.languages,
            model: result.model,
            format: result.format,
            bytesReceived: result.bytes,
            /* Silence really does transcribe to an empty string; the browser shows
               that as "no usable speech" rather than inventing text for it. */
            empty: result.transcript.trim().length === 0
          },
          meta: { sessionId: meta.sessionId, stage: meta.stage, stageName: meta.stageName, questionId: meta.questionId, demoOnly: false }
        });
        return;
      }

      if (path === '/health' || path === '/api/transcribe') { status = 405; return sendError(req, res, 'METHOD_NOT_ALLOWED'); }
      status = 404;
      sendError(req, res, 'NOT_FOUND');
    } catch (err) {
      if (err instanceof TranscribeError) {
        const entry = ERROR_TABLE[err.code] || ERROR_TABLE.INTERNAL_ERROR;
        status = entry.status;
        sendJson(req, res, status, {
          success: false,
          error: {
            code: ERROR_TABLE[err.code] ? err.code : 'INTERNAL_ERROR',
            message: err.message,
            retryable: typeof err.retryable === 'boolean' ? err.retryable : entry.retryable
          }
        });
        return;
      }
      if (err instanceof MultipartError) { status = 400; sendError(req, res, err.code); return; }
      status = 500;
      /* Never surface internals: no stack, no request bytes, no key. */
      if (!res.headersSent) sendError(req, res, 'INTERNAL_ERROR');
      else res.end();
    } finally {
      /* Transcript text and audio bytes are deliberately absent from this line. */
      log({ method: req.method, path, status, ms: Date.now() - started, bytes: Number(req.headers['content-length']) || 0 });
    }
  });
}

function defaultLog(line) {
  console.log(`[tope-transcribe] ${line.method} ${line.path} ${line.status} ${line.ms}ms ${line.bytes}B`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  let activeProvider;
  try {
    activeProvider = resolveProvider(process.env.TRANSCRIBE_PROVIDER || 'openai');
  } catch {
    console.error(`TRANSCRIBE_PROVIDER 仅支持 openai 或 bailian，收到：${process.env.TRANSCRIBE_PROVIDER}`);
    process.exit(1);
  }
  // 只报告「有没有配」，绝不打印密钥内容；缺密钥也照常启动，便于无 Key 演示。
  const configuredKey = activeProvider === 'bailian'
    ? Boolean(process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
  if (!configuredKey) {
    const keyName = activeProvider === 'bailian' ? 'BAILIAN_API_KEY（或 DASHSCOPE_API_KEY）' : 'OPENAI_API_KEY';
    console.warn(`警告：未配置 ${keyName}，/api/transcribe 将返回 503，不会产生任何伪造的转写文本。`);
  }
  if (activeProvider === 'bailian' && /\{WorkspaceId\}/.test(process.env.BAILIAN_BASE_URL || '')) {
    console.warn('警告：BAILIAN_BASE_URL 里仍是 {WorkspaceId} 占位符。留空即用默认地址 https://dashscope.aliyuncs.com/compatible-mode/v1（与实测通过的评分地址同一个 host），或填控制台里的真实业务空间 ID。');
  }
  const server = createTranscriptionServer({ provider: activeProvider });
  server.listen(port, '127.0.0.1', () => {
    console.log(`TOPE Mate transcription server (provider=${activeProvider}) listening on http://127.0.0.1:${port}`);
    console.log(`健康检查：curl http://127.0.0.1:${port}/health`);
  });
}
