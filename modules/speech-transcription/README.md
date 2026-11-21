# TOPE Mate 语音转写模块

把浏览器录音转成英文文本，供 AI 评分使用。独立进程、独立端口（默认 `3002`），与评分模块 `modules/ai-scoring`（默认 `3001`）互不影响。

- 零第三方依赖，只用 `node:http`、`node:test`；无需 `npm install`。
- 只监听 `127.0.0.1`，只接受本机前端预览页跨域。
- 没有 API Key 时明确报错，绝不返回伪造文本；音频不落盘、不打印转写内容。

## 快速开始（Windows PowerShell）

```powershell
node -v                              # 需要 Node.js 18+
cd modules\speech-transcription
$env:OPENAI_API_KEY = "sk-..."       # 只写在当前会话，不写文件
npm run serve
```

另开一个终端：

```powershell
curl.exe http://127.0.0.1:3002/health
```

`keyConfigured:false` 表示没读到 Key，此时 `/api/transcribe` 会返回 `503`。

## 测试

```powershell
npm test        # node --test，全部离线，用假 fetch 打桩，不调用付费接口、不需要 Key
```

## 目录

```
src/multipart.mjs    零依赖 multipart/form-data 解析（按字节切分，保留音频原样）
src/provider.mjs     OpenAI 转写接口封装，格式白名单与错误码
src/http-server.mjs  /health 与 /api/transcribe、CORS、体积与超时限制
docs/transcribe_api.md  请求/响应/错误码合约
tests/*.test.mjs     离线单元测试
```

## 前端对接

`services/transcription.js` 负责上传，`config/exam-config.js` 里的 `services.transcribeEndpoint` 指向 `http://127.0.0.1:3002/api/transcribe`。上传由用户主动确认后触发，结果按 `sessionId` + `stage` 绑定回对应录音记录。
