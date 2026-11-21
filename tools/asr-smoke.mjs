/**
 * 最小范围真实 ASR 调用的准备脚本：只发一次、只发 2 秒静音 wav，用来回答「这把 Key 到底能不能调 qwen3-asr-flash」。
 *
 *   node tools/asr-smoke.mjs --dry-run              完全离线：只打印将要发送的报文形状，不发起任何请求
 *   node tools/asr-smoke.mjs                        向本机 3002 发一次真实请求（有没有 Key 由服务端 .env 决定）
 *   node tools/asr-smoke.mjs --file a.webm --seconds 12 --mime audio/webm
 *                                                  改用你自己的录音（脚本不读取也不上传任何路径给模型）
 *
 * 设计约束：
 * - 脚本本身不需要、也绝不读取任何 API Key；密钥只留在 modules/speech-transcription/.env。
 * - 不做重试、不批量提交，失败就停，避免意外计费。
 * - 按官方 0.00022 元/秒（不足 1 秒按 1 秒计）估算，默认 2 秒静音约 0.00044 元。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const BASE = opt('url', 'http://127.0.0.1:3002');
const LANGUAGE = opt('language', 'en');
const STAGE = opt('stage', 'speech');
const STAGE_NAME = opt('stageName', '冒烟测试');
const SECONDS = Number(opt('seconds', '2'));
const dryRun = flag('dry-run');

/** 16 kHz / 16 bit / 单声道的静音 wav：不写文件，只在内存里拼 header + 全零采样。 */
function silentWav(seconds) {
  const sampleRate = 16000;
  const samples = Math.max(1, Math.round(sampleRate * seconds));
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const useFile = opt('file', '');
const audio = useFile ? fs.readFileSync(path.resolve(useFile)) : silentWav(SECONDS);
const mimeType = opt('mime', useFile ? 'audio/webm' : 'audio/wav');
const filename = useFile ? path.basename(useFile) : 'smoke-silent.wav';
const meta = {
  examType: 'C', stage: STAGE, stageName: STAGE_NAME,
  sessionId: 'asr-smoke', questionId: 'asr-smoke-001',
  language: LANGUAGE, durationSeconds: SECONDS, mimeType
};

console.log(`[asr-smoke] POST ${BASE}/api/transcribe`);
console.log(`[asr-smoke] meta: ${JSON.stringify(meta)}`);
console.log(`[asr-smoke] audio: ${audio.length} 字节（${useFile ? filename : '本机生成的静音 wav'}）`);
console.log(`[asr-smoke] 预算参考：qwen3-asr-flash 0.00022 元/秒，约 ${SECONDS} 秒 ≈ ${(SECONDS * 0.00022).toFixed(5)} 元`);
console.log('[asr-smoke] 本脚本不读取任何 API Key；密钥只在服务端 .env 里。');

if (dryRun) {
  console.log('[asr-smoke] --dry-run：未发起任何网络请求，也未产生任何调用费用。');
  console.log('[asr-smoke] 上线前可先核对服务配置：curl http://127.0.0.1:3002/health（应看到 provider=bailian、maxAudioSeconds=300、keyConfigured=true）。');
  process.exit(0);
}

/* 先读一次本机健康检查：把「服务端实际生效的供应商/模型/上限」打出来，
   真实调用前就能发现 Key 没读到、供应商还是 openai 这类配置问题，省掉一次无谓的网络往返。 */
try {
  const health = await (await fetch(`${BASE}/health`, { method: 'GET' })).json();
  const d = health.data || {};
  console.log(`[asr-smoke] 服务端配置：provider=${d.provider ?? '?'} model=${d.model ?? '?'} keyConfigured=${d.keyConfigured ?? '?'} timeout=${d.timeoutMs ?? '?'}ms 上限=${d.maxAudioBytes ?? '?'}B/${d.maxAudioSeconds ?? '不声明'}s`);
  if (d.provider && d.provider !== 'bailian') console.log('[asr-smoke] 注意：当前转写服务不是 bailian 通路，本次调用不会用到百炼 Key。要把 TRANSCRIBE_PROVIDER=bailian 写进 .env 再重启服务。');
  if (d.keyConfigured === false) console.log('[asr-smoke] 注意：服务端没读到百炼 Key，本次调用只会得到 503 API_KEY_MISSING，不会产生任何供应商请求或费用。');
} catch {
  console.log('[asr-smoke] 读取 /health 失败：请先双击「启动 AI 后端.bat」或手动启动转写服务后重试。');
}

const form = new FormData();
form.append('meta', JSON.stringify(meta));
form.append('audio', new Blob([audio], { type: mimeType }), filename);

const started = Date.now();
let res;
try {
  res = await fetch(`${BASE}/api/transcribe`, { method: 'POST', body: form });
} catch (err) {
  console.error(`[asr-smoke] 请求没发出去：${err.message}`);
  console.error('[asr-smoke] 请先双击「启动 AI 后端.bat」，再用 curl http://127.0.0.1:3002/health 确认服务在跑。');
  process.exit(1);
}
const elapsed = Date.now() - started;
const text = await res.text();
let body = null;
try { body = JSON.parse(text); } catch { /* 非 JSON 时按原文打印 */ }

console.log(`[asr-smoke] HTTP ${res.status}，用时 ${(elapsed / 1000).toFixed(2)} 秒`);
if (body && body.success) {
  const t = body.data?.transcript ?? '';
  console.log(`[asr-smoke] provider=${body.data?.model ?? '未知'} format=${body.data?.format ?? '未知'} bytes=${body.data?.bytesReceived ?? '?'}`);
  console.log(t ? `[asr-smoke] 转写文本：${t}` : '[asr-smoke] 转写为空（empty=true 是正常结果：静音本来就没有词）。');
  console.log('[asr-smoke] 结论：这把 Key 对转写模型的调用权限可用，可以进入浏览器端的真实录音验收。');
} else {
  const e = body?.error || {};
  console.log(`[asr-smoke] 错误码：${e.code || '未返回结构化错误'}  retryable=${e.retryable ?? '?'}`);
  console.log(`[asr-smoke] 提示：${e.message || text.slice(0, 300)}`);
  const hints = {
    API_KEY_MISSING: '服务端没有读到百炼 Key：确认 .env 写在 modules/speech-transcription/ 下、变量名是 BAILIAN_API_KEY 或 DASHSCOPE_API_KEY，并重新双击启动器。',
    PROVIDER_CONFIG_ERROR: 'BAILIAN_BASE_URL 里仍是 {WorkspaceId} 或不是 https：留空即可使用已验证的 dashscope.aliyuncs.com 地址。',
    PROVIDER_AUTH_ERROR: 'Key 无效或与地域不匹配：不要自行换地域或重新购买服务，先和准备 Key 的成员核对。',
    PROVIDER_MODEL_UNAVAILABLE: '这把 Key 的业务空间没有开通 qwen3-asr-flash：这正是本次要确认的问题，请在控制台「模型服务」里查看开通状态。',
    PROVIDER_HTTP_ERROR: '供应商侧故障或额度/欠费问题：先看控制台用量与欠费状态，再重试一次，不要循环重发。',
    UNSUPPORTED_FORMAT: '格式不在这条通路的白名单里（m4a/mp4/mov 不支持）：请用 Chrome 或 Edge 录音。',
    AUDIO_TOO_LONG: '超过单次 5 分钟上限，服务不会截断：需要更长录音要另做分段提交方案。'
  };
  if (hints[e.code]) console.log(`[asr-smoke] 下一步：${hints[e.code]}`);
}
process.exit(body && body.success ? 0 : 1);
