/**
 * 阿里云百炼 qwen3-asr-flash 转写通路（OpenAI 兼容 Chat Completions）。
 *
 * 文档依据（2026-11-21 核实，help.aliyun.com/zh/model-studio/qwen-asr-api-reference 与
 * non-realtime-speech-recognition-user-guide）：
 *   POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
 *   messages[0].content[0] = { type: 'input_audio', input_audio: { data: <公网 URL 或 Base64 Data URI> } }
 *   —— 官方明确「不支持直接传入本地文件绝对路径」，所以本通路只把内存里的录音编码成 Data URI。
 *   asr_options.language 只接受具体语种代码（en = 英文）；语种不确定或混合时不应指定。
 *   限制：单次 1 个音频、≤5 分钟、Base64 编码后 ≤10 MB；
 *         格式含 aac/amr/avi/aiff/flac/flv/mkv/mp3/mpeg/ogg/opus/wav/webm/wma/wmv，
 *         不含 m4a/mp4/mov（Safari 的 MediaRecorder 产物因此走不通这条通路）。
 *   非 PCM 采样率不限，服务端统一重采样为 16 kHz；非流式结果在 choices[0].message.content。
 *   {WorkspaceId} 由用户在控制台「业务空间详情」确认，代码里只保留占位符。
 */
import { TranscribeError, audioFormatOf } from './provider.mjs';

export const BAILIAN_ASR_MODEL = 'qwen3-asr-flash';
/** 官方口径是「编码后」体积 ≤10 MB，Base64 放大约 4/3。 */
export const BAILIAN_MAX_ENCODED_BYTES = 10 * 1024 * 1024;
/** Data URI 前缀本身也计入编码后体积，预留 1 KB 余量。 */
export const DATA_URI_HEADROOM_BYTES = 1024;
export const BAILIAN_MAX_RAW_BYTES = Math.floor(((BAILIAN_MAX_ENCODED_BYTES - DATA_URI_HEADROOM_BYTES) * 3) / 4);
export const BAILIAN_MAX_AUDIO_SECONDS = 300;
/** 官方格式列表与本服务 MIME 映射的交集：浏览器录音（WebM/Opus）在内。 */
export const BAILIAN_ASR_FORMATS = Object.freeze({
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac'
});
/** asr_options.language 的官方取值；不在表内时按「语种不确定」省略该参数。 */
export const ASR_LANGUAGE_CODES = Object.freeze([
  'zh', 'yue', 'en', 'ja', 'de', 'ko', 'ru', 'fr', 'pt', 'ar', 'it', 'es', 'hi', 'id',
  'th', 'tr', 'uk', 'vi', 'cs', 'da', 'fil', 'fi', 'is', 'ms', 'no', 'pl', 'sv'
]);
export const WORKSPACE_ID_PLACEHOLDER = '{WorkspaceId}';
/**
 * 北京地域的通用兼容域名，与成员 B 2026-11-21 实测通过的评分地址同一个 host（官方说明「现有域名仍可正常使用」）。
 * 官方另推荐业务空间专属域名 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1，
 * 需要时用 BAILIAN_BASE_URL 覆盖；本仓库不硬编码任何真实业务空间 ID。
 */
export const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export function bailianChatUrl(baseUrl) {
  const value = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!value) throw new TranscribeError('PROVIDER_CONFIG_ERROR', '未配置 BAILIAN_BASE_URL，无法调用百炼转写。');
  if (value.includes(WORKSPACE_ID_PLACEHOLDER)) {
    throw new TranscribeError('PROVIDER_CONFIG_ERROR', 'BAILIAN_BASE_URL 里的 {WorkspaceId} 需要替换为控制台「业务空间详情」中的真实业务空间 ID，或改用默认的 https://dashscope.aliyuncs.com/compatible-mode/v1。');
  }
  if (!/^https:\/\//i.test(value)) throw new TranscribeError('PROVIDER_CONFIG_ERROR', 'BAILIAN_BASE_URL 必须以 https:// 开头。');
  return `${value.replace(/\/(chat\/completions|responses)$/i, '')}/chat/completions`;
}

function asrOptions(language, enableItn) {
  const base = String(language || '').trim().toLowerCase().split('-')[0];
  const options = { enable_itn: enableItn === true };
  // 官方：只能指定一个语种；不在取值表内（或混合语种）时省略，交由模型自动识别。
  if (ASR_LANGUAGE_CODES.includes(base)) options.language = base;
  return options;
}

/** Data URI 形态：data:<mediatype>;base64,<data>。 */
export function toDataUri(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * @returns {Promise<{transcript:string, languages:string[], model:string, bytes:number, format:string}>}
 * 与 transcribeWithOpenAI 返回同构字段，便于服务层共用信封组装；
 * languages 恒为空数组，因为该模型不在响应里报告语种检测结果。
 */
export async function transcribeWithBailian(
  { audio, mimeType, language = 'en', durationSeconds = null },
  {
    apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
    model = process.env.BAILIAN_ASR_MODEL || BAILIAN_ASR_MODEL,
    baseUrl = process.env.BAILIAN_BASE_URL || DEFAULT_BAILIAN_BASE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 90000,
    enableItn = false
  } = {}
) {
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw new TranscribeError('EMPTY_AUDIO', '没有收到任何音频数据。');
  }
  const format = audioFormatOf(mimeType);
  if (!format) {
    throw new TranscribeError('UNSUPPORTED_FORMAT', `不支持的音频格式：${String(mimeType || '未知').slice(0, 60)}。`);
  }
  if (!Object.prototype.hasOwnProperty.call(BAILIAN_ASR_FORMATS, format.ext)) {
    throw new TranscribeError('UNSUPPORTED_FORMAT',
      `qwen3-asr-flash 的官方格式列表不含 ${format.ext}；请用 Chrome 或 Edge 录音（WebM/Opus），或下载录音后转成 wav/mp3 再重试。`);
  }
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > BAILIAN_MAX_AUDIO_SECONDS) {
    /* 明确报错，绝不截断后当作完整转写。 */
    throw new TranscribeError('AUDIO_TOO_LONG',
      `这段录音约 ${Math.round(durationSeconds)} 秒，超过 qwen3-asr-flash 单次 5 分钟（300 秒）的上限；服务不会截断音频，请分段练习后重试。`,
      { retryable: false });
  }
  if (!apiKey) {
    throw new TranscribeError('API_KEY_MISSING', '服务器尚未配置百炼转写所需的 API Key（BAILIAN_API_KEY 或 DASHSCOPE_API_KEY），无法生成转写文本。', { retryable: false });
  }
  const url = bailianChatUrl(baseUrl);
  const encoded = toDataUri(audio, BAILIAN_ASR_FORMATS[format.ext]);
  if (encoded.length > BAILIAN_MAX_ENCODED_BYTES) {
    throw new TranscribeError('AUDIO_TOO_LARGE',
      `录音 Base64 编码后约 ${Math.round(encoded.length / 1024 / 1024)} MB，超过百炼单次 10 MB 上限，请缩短这一阶段或用更低码率录音。`,
      { retryable: false });
  }
  if (typeof fetchImpl !== 'function') {
    throw new TranscribeError('FETCH_UNAVAILABLE', '服务器运行环境不支持调用转写服务，请使用 Node.js 18+。', { retryable: false });
  }

  const body = {
    model,
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: encoded } }] }],
    stream: false,
    asr_options: asrOptions(language, enableItn)
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, 300000)));
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    /* 只带状态码：供应商响应体可能回显请求内容，不能往客户端转发。 */
    const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_ERROR'
      : response.status === 404 ? 'PROVIDER_MODEL_UNAVAILABLE' : 'PROVIDER_HTTP_ERROR';
    const message = code === 'PROVIDER_AUTH_ERROR' ? `百炼鉴权或业务空间调用权限校验未通过（HTTP ${response.status}）。`
      : code === 'PROVIDER_MODEL_UNAVAILABLE' ? `百炼未找到该模型或接口（HTTP 404），请核对模型 ID、业务空间权限与地域。`
        : `转写服务暂时不可用（HTTP ${response.status}），请稍后重试。`;
    throw new TranscribeError(code, message, { retryable: response.status >= 500 || response.status === 429 });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TranscribeError('PROVIDER_BAD_RESPONSE', '转写服务返回了无法解析的结果，本次不生成转写文本。', { retryable: true });
  }
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  if (choice && choice.finish_reason === 'length') {
    throw new TranscribeError('PROVIDER_BAD_RESPONSE', '转写结果被长度上限截断，本次不提交这份转写。', { retryable: true });
  }
  const content = choice?.message?.content;
  const transcript = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(part => (typeof part === 'string' ? part : part && typeof part.text === 'string' ? part.text : '')).join('') : null;
  if (typeof transcript !== 'string') {
    throw new TranscribeError('PROVIDER_BAD_RESPONSE', '转写服务没有返回文本结果，本次不生成转写文本。', { retryable: true });
  }

  return {
    transcript,
    languages: [],
    model: typeof model === 'string' ? model : BAILIAN_ASR_MODEL,
    bytes: audio.length,
    format: format.ext
  };
}
