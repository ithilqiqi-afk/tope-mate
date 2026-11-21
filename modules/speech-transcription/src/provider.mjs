/**
 * OpenAI transcription provider.
 *
 * Parameter names and audio-format support follow the official Transcriptions API
 * reference (checked 2026-11-21):
 *   POST https://api.openai.com/v1/audio/transcriptions, multipart/form-data
 *   Input formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm — files up to 25 MB.
 *   `gpt-transcribe` is the recommended model; it takes the plural `languages`
 *   hint and must NOT be sent the singular `language` field.
 *   `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and
 *   `gpt-4o-transcribe-diarize` are deprecated (shutdown 2027-02-26) and take the
 *   singular `language` instead.
 */

export const PROVIDER_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const DEFAULT_MODEL = 'gpt-transcribe';
/** Models that accept the plural `languages[]` hint rather than `language`. */
const LANGUAGES_PLURAL_MODELS = new Set(['gpt-transcribe']);
/** Formats the provider documents, keyed by the extension we map a MIME type to. */
export const SUPPORTED_AUDIO = Object.freeze({
  webm: { mime: 'audio/webm', label: 'WebM (Opus)' },
  ogg: { mime: 'audio/ogg', label: 'Ogg (Opus)' },
  wav: { mime: 'audio/wav', label: 'WAV' },
  mp3: { mime: 'audio/mpeg', label: 'MP3' },
  m4a: { mime: 'audio/mp4', label: 'M4A / AAC' },
  flac: { mime: 'audio/flac', label: 'FLAC' }
});
export const PROVIDER_MAX_BYTES = 25 * 1024 * 1024;

export class TranscribeError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'TranscribeError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * MediaRecorder reports MIME types with codec parameters, e.g.
 * `audio/webm;codecs=opus`. Returns { ext, mime } or null when unsupported.
 */
export function audioFormatOf(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/webm':
    case 'video/webm':
      return { ext: 'webm', mime: 'audio/webm' };
    case 'audio/ogg':
    case 'application/ogg':
      return { ext: 'ogg', mime: 'audio/ogg' };
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return { ext: 'wav', mime: 'audio/wav' };
    case 'audio/mpeg':
    case 'audio/mp3':
      return { ext: 'mp3', mime: 'audio/mpeg' };
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      return { ext: 'm4a', mime: 'audio/mp4' };
    case 'audio/flac':
    case 'audio/x-flac':
      return { ext: 'flac', mime: 'audio/flac' };
    default:
      return null;
  }
}

function languageHintFields(model, language) {
  const code = String(language || 'en').trim() || 'en';
  return LANGUAGES_PLURAL_MODELS.has(String(model)) ? { languages: code } : { language: code };
}

/**
 * Transcribe one in-memory audio buffer. The API key stays on this side of the
 * boundary and is never echoed back in an error or a log line.
 *
 * @returns {Promise<{transcript:string, languages:string[], model:string, bytes:number, format:string}>}
 */
export async function transcribeWithOpenAI(
  { audio, mimeType, language = 'en', prompt = '', sessionId = null },
  {
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 60000,
    url = PROVIDER_URL
  } = {}
) {
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw new TranscribeError('EMPTY_AUDIO', '没有收到任何音频数据。');
  }
  const format = audioFormatOf(mimeType);
  if (!format) {
    throw new TranscribeError('UNSUPPORTED_FORMAT', `不支持的音频格式：${String(mimeType || '未知').slice(0, 60)}。`);
  }
  if (audio.length > PROVIDER_MAX_BYTES) {
    throw new TranscribeError('AUDIO_TOO_LARGE', `音频超过转写服务 ${PROVIDER_MAX_BYTES / 1024 / 1024} MB 的上传上限。`);
  }
  if (!apiKey) {
    throw new TranscribeError('API_KEY_MISSING', '服务器尚未配置语音转写所需的 API Key，无法生成转写文本。', { retryable: false });
  }
  if (typeof fetchImpl !== 'function') {
    throw new TranscribeError('FETCH_UNAVAILABLE', '服务器运行环境不支持调用转写服务，请使用 Node.js 18+。', { retryable: false });
  }

  const form = new FormData();
  /* The provider identifies the payload from the filename extension plus content
     type, so both have to carry the real format rather than a generic blob name. */
  form.append('file', new Blob([audio], { type: format.mime }), `tope-mate-${sessionId ?? 'audio'}.${format.ext}`);
  form.append('model', model);
  for (const [key, value] of Object.entries(languageHintFields(model, language))) form.append(key, value);
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', String(prompt).slice(0, 224));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, 300000)));
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new TranscribeError('PROVIDER_TIMEOUT', '转写服务响应超时，请稍后重试。', { retryable: true });
    }
    throw new TranscribeError('PROVIDER_NETWORK_ERROR', '转写服务连接失败，请检查网络后重试。', { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    /* Status text only: the provider body can echo parts of the request. */
    throw new TranscribeError('PROVIDER_HTTP_ERROR', `转写服务暂时不可用（HTTP ${response.status}），请稍后重试。`, { retryable: response.status >= 500 });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TranscribeError('PROVIDER_BAD_RESPONSE', '转写服务返回了无法解析的结果，本次不生成转写文本。', { retryable: true });
  }
  if (!payload || typeof payload.text !== 'string') {
    throw new TranscribeError('PROVIDER_BAD_RESPONSE', '转写服务没有返回文本结果，本次不生成转写文本。', { retryable: true });
  }

  return {
    transcript: payload.text,
    languages: Array.isArray(payload.languages) ? payload.languages.map(x => (x && typeof x === 'object' ? x.code : x)).filter(x => typeof x === 'string') : [],
    model: typeof model === 'string' ? model : DEFAULT_MODEL,
    bytes: audio.length,
    format: format.ext
  };
}
