# TOPE Mate 语音转写服务（`/api/transcribe`）合约 v1（`transcribe_v1`）

零第三方依赖的 Node.js 服务，只做一件事：把浏览器上传的一段录音转成文本，交给评分服务。**不产生分数、不预测官方等级、不保存音频。**

## 启动

```powershell
cd modules\speech-transcription
$env:OPENAI_API_KEY = "粘贴你的 Key"   # 只写在当前 PowerShell 会话里
npm run serve                          # 默认 http://127.0.0.1:3002
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 无 | 必填。缺失时接口返回 `503 API_KEY_MISSING`，不返回任何伪造文本。 |
| `PORT` | `3002` | 只监听 `127.0.0.1`，不对外网卡暴露。 |
| `TRANSCRIBE_MODEL` | `gpt-transcribe` | 供应商模型名。`gpt-transcribe` 使用复数 `languages` 提示；旧模型自动改用单数 `language`。 |
| `TRANSCRIBE_TIMEOUT_MS` | `60000` | 单次供应商调用超时，超时返回 `504 PROVIDER_TIMEOUT`。 |
| `MAX_AUDIO_BYTES` | `12582912`（12 MB） | 请求体上限，同时被压到供应商 25 MB 上限以下。 |
| `TRANSCRIBE_PROMPT` | 空 | 可选的领域词提示，截断到 224 字符。 |

## `GET /health`

```json
{
  "success": true,
  "data": {
    "status": "ok", "contract": "transcribe_v1", "moduleVersion": "0.1.0",
    "provider": "openai", "model": "gpt-transcribe",
    "keyConfigured": false, "maxAudioBytes": 12582912,
    "allowedFormats": ["flac", "m4a", "mp3", "ogg", "wav", "webm"]
  },
  "meta": { "demoOnly": false }
}
```

`keyConfigured` 只报布尔值，永不回显 Key 本身。

## `POST /api/transcribe`

`multipart/form-data`，两个字段：

- `audio`：音频 Blob，字段名 `audio` 或 `file` 均可。以该 part 自己的 `Content-Type` 判定格式，浏览器实际会写 `audio/webm;codecs=opus` 或 `audio/ogg;codecs=opus`。
- `meta`：JSON 字符串。`sessionId`、`stage`、`stageName`、`examType`、`questionId`、`language`、`durationSeconds`、`mimeType` 全部做类型与长度校验；`stage` 必填非空（A 侧阶段键，原样回传用于绑定，服务端不解释其含义），`examType` 若提供只能是 `B`/`C`，`language` 缺省 `en`。

成功（含静音）：

```json
{
  "success": true,
  "data": {
    "contract": "transcribe_v1",
    "transcript": "Good morning examiners.",
    "language": "en",
    "detectedLanguages": ["en"],
    "model": "gpt-transcribe",
    "format": "webm",
    "bytesReceived": 183244,
    "empty": false
  },
  "meta": { "sessionId": "s-7", "stage": "speech", "stageName": "个人陈述", "questionId": "c-speech-001", "demoOnly": false }
}
```

`meta` 由服务端原样回传请求里的会话与阶段标识，前端必须再比对一次当前 session 才采用结果，防止迟到的响应覆盖新一轮考试。

静音是真的听不出内容，因此返回 `200` + `transcript:""` + `empty:true`，由前端归入「证据不足」，不算请求失败。

失败：

```json
{ "success": false, "error": { "code": "API_KEY_MISSING", "message": "服务器尚未配置语音转写所需的 API Key，无法生成转写文本。", "retryable": false } }
```

| code | HTTP | retryable | 含义 |
| --- | --- | --- | --- |
| `INVALID_CONTENT_TYPE` | 400 | 否 | 没用 `multipart/form-data`。 |
| `MALFORMED_MULTIPART` | 400 | 是 | 分界符、头部或字段数量不合法。 |
| `CORS_FORBIDDEN` | 403 | 否 | 预检来源不在白名单。 |
| `BODY_TIMEOUT` | 408 | 是 | 60 秒内没传完。 |
| `PAYLOAD_TOO_LARGE` | 413 | 否 | 超过 `MAX_AUDIO_BYTES`。 |
| `UNSUPPORTED_FORMAT` | 415 | 否 | MIME 不在支持列表。 |
| `MISSING_AUDIO` / `EMPTY_AUDIO` / `INVALID_META` | 422 | 否 | 没有音频 / 零字节 / 阶段信息不合法。 |
| `AUDIO_TOO_LARGE` | 413 | 否 | 超过供应商 25 MB 单文件上限。 |
| `API_KEY_MISSING` / `FETCH_UNAVAILABLE` | 503 | 否 | 未配 Key / Node 版本过低。 |
| `PROVIDER_HTTP_ERROR` / `PROVIDER_NETWORK_ERROR` / `PROVIDER_BAD_RESPONSE` | 502 | 供应商 5xx 或网络类为「是」 | 供应商侧故障，不产出文本。 |
| `PROVIDER_TIMEOUT` | 504 | 是 | 供应商超时。 |
| `METHOD_NOT_ALLOWED` / `NOT_FOUND` | 405 / 404 | 否 | 路径或方法不对。 |
| `INTERNAL_ERROR` | 500 | 否 | 兜底，响应不含堆栈。 |

## 安全边界

- Key 只从服务端环境变量读取，不进请求体、不进响应、不进日志。
- CORS 白名单仅 `http://localhost:5173` 与 `http://127.0.0.1:5173`；其他来源不带跨域头，浏览器会拦截。
- 只监听 `127.0.0.1`。
- 音频只在内存里存在，不写盘；每次上传落一行日志：`方法 路径 状态 耗时 字节数`，不含转写文本。
- 供应商 HTTP 错误只带状态码，不转发响应体，避免回显请求内容。

## 与评分服务的衔接

转写结果不是评分结果。拿到 `transcript` 后，前端把它连同题目、阶段、时长一起提交给评分服务（默认 `http://127.0.0.1:3001/api/evaluate`，合约见 `modules/ai-scoring/docs/api_contract.md`），由评分服务产出 `practiceScore` 等字段。转写服务本身没有任何评分语义。
