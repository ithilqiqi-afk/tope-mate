# HTTP 评分接口联调指南（v0.6 / Schema 1.4.0）

本文档面向同学 A 的前端联调。服务端代码位于 `src/http-server.mjs`，仅使用 Node.js 内置 `node:http`，无第三方运行依赖。

## 1. 本地服务启动

在 `modules/ai-scoring/` 目录下：

```bash
npm run serve
# 等价于：node src/http-server.mjs
```

默认监听 `http://127.0.0.1:3001`（只绑定回环地址，不对外网开放）。可用 `PORT` 环境变量改端口。

若环境没有 npm，可直接用 Node 可执行文件运行：`node src/http-server.mjs`。

## 2. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SCORING_MODE` | `heuristic` | `heuristic`：离线文本信号提示模式，无需 API Key，`practiceScore` 恒为 `null`，绝不产生假分数。`ai`：调用真实模型（`scoreWithOpenAI`），需要服务端配置 `OPENAI_API_KEY`。其他取值启动即报错。 |
| `OPENAI_API_KEY` | 无 | 仅 `ai` 模式需要；只能配置在服务端环境变量，不得写入前端代码或提交到仓库。缺失时 `/api/evaluate` 返回 503。 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 真实 AI 模式使用的模型标识。 |
| `PORT` | `3001` | 监听端口。 |

示例（Windows PowerShell）：

```powershell
$env:SCORING_MODE="ai"; $env:OPENAI_API_KEY="<服务器密钥>"; npm run serve
```

## 3. GET /health

```bash
curl http://127.0.0.1:3001/health
```

响应（200）：

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "mode": "heuristic",
    "schemaVersion": "1.4.0",
    "moduleVersion": "0.6.0",
    "aiKeyConfigured": false
  },
  "meta": { "questionId": null, "demoOnly": false }
}
```

`aiKeyConfigured` 只是布尔值，不会泄露密钥内容。

## 4. POST /api/evaluate

### 请求字段

| 字段 | 必填 | 约束 |
|---|---|---|
| `examType` | 是 | `B` 或 `C` |
| `stage` | 是 | B：`self_intro` / `statement` / `discussion`；C：`speech` / `qa` |
| `question` | 是 | 非空字符串，≤3000 字符 |
| `questionId` | 否 | 非空字符串，≤128 字符；仅作题目追踪标识，不参与 AI 评分判断，原样回填到 `meta.questionId` |
| `transcript` | 是 | 字符串，≤30000 字符；空白视为空转写（422） |
| `durationSeconds` | 是 | 0–3600 的数字 |
| `targetDurationSeconds` | 否 | 正数 ≤3600；缺失时时间控制维度不评估 |
| `rubric` | 否 | 短版本标签字符串或 null |
| `assessedSpeaker` | B discussion 可选 | `A` / `B` / `C` |
| `speakerTurns` | B discussion 可选 | ≤150 条 `{speaker, text}`；`speaker` 为 `A`/`B`/`C`/`examiner` |

请求体上限 **128 KB**。

### A 侧字段映射约定

- 前端旧阶段名 `intro` → 请求 `stage: "self_intro"`；`presentation` → `stage: "statement"`。映射由 A 在发起请求前完成，服务端不接受旧名称。
- 题目对象由 A 拼接为 `question` 字符串；题目编号放入 `questionId`（可选）。
- `questionId` 不进入模型提示词，只用于前端追踪与 `meta.questionId` 回填。

### 请求示例

```bash
curl -X POST http://127.0.0.1:3001/api/evaluate \
  -H "Content-Type: application/json" \
  -d @fixtures/c_high.json
```

### 成功响应（200）

```json
{
  "success": true,
  "data": { "schemaVersion": "1.4.0", "practiceScore": null, "...": "完整 v1.4.0 评分报告对象" },
  "meta": { "questionId": null, "demoOnly": false }
}
```

`data` 是完整报告对象（字段见 `api_contract.md`），不是字符串。真实接口 `meta.demoOnly` 恒为 `false`；只有 `examples/http-success-scored-demo.json` 这类合成演示样例才允许 `demoOnly: true`。

### 错误响应

```json
{
  "success": false,
  "error": { "code": "EMPTY_TRANSCRIPT", "message": "未提供转写文本，请重新录音或编辑文本后再试。", "retryable": false }
}
```

| HTTP 状态 | code | 场景 |
|---|---|---|
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 404 / 405 | `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 路径或方法不支持 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 128 KB |
| 422 | `INVALID_FIELD` | 字段无效（类型、范围、questionId 超长等） |
| 422 | `EMPTY_TRANSCRIPT` | transcript 为空或全空白 |
| 503 | `API_KEY_MISSING` | ai 模式未配置 OPENAI_API_KEY |
| 502 | `PROVIDER_HTTP_ERROR` / `PROVIDER_NETWORK_ERROR` / `PROVIDER_INCOMPLETE` / `PROVIDER_REFUSAL` / `INVALID_MODEL_OUTPUT` / `FETCH_UNAVAILABLE` | 模型服务错误或输出未通过校验 |
| 504 | `PROVIDER_TIMEOUT` | 模型响应超时 |
| 500 | `INTERNAL_ERROR` | 服务器内部异常（不暴露堆栈与请求数据） |

真实 AI 未调用成功时不会返回任何分数；错误消息为客户端安全文案，不含密钥、堆栈或敏感请求内容。

## 5. CORS

仅允许本地开发前端两个来源：`http://localhost:5173` 和 `http://127.0.0.1:5173`。不使用 `*` 通配。`OPTIONS` 预检返回 204 并携带 `Access-Control-Allow-Origin`（回显白名单来源）、`Access-Control-Allow-Methods: GET, POST, OPTIONS`、`Access-Control-Allow-Headers: Content-Type`、`Vary: Origin`。非白名单来源的预检返回 403，普通请求不带 CORS 头（浏览器将拦截读取）。

## 6. 模拟模式与真实 AI 模式的区别

| | `heuristic`（默认） | `ai` |
|---|---|---|
| API Key | 不需要 | 服务端必须配置 |
| `practiceScore` | 恒为 `null` | 模型维度分通过校验后由后端加权计算 |
| 反馈内容 | 文本信号提示（PEEL 标记、词数、时长提示），明确非质量评分 | 完整维度分、理由、原文证据 |
| 失败行为 | 只做字段校验 | 模型错误 → 502/503/504，绝不伪造分数 |

两种模式都遵守：`officialAssessment.level` 恒为 `null`，不预测官方等级；`examiner` 轮次不算 B 讨论同伴互动证据。

## 7. 固定联调样例（examples/）

| 文件 | 说明 |
|---|---|
| `http-success-heuristic.json` | 真实 heuristic 接口 200 响应，`practiceScore: null` |
| `http-success-scored-demo.json` | 合成 81 分完整 v1.4.0 报告演示，`meta.demoOnly: true`，含非官方免责声明；不是真实 AI 评分，前端展示时必须标注演示 |
| `http-error-empty-transcript.json` | 422 空转写错误 |
| `http-error-no-key.json` | 503 缺少 API Key 错误 |

## 8. 测试

```bash
npm test          # 含 tests/http-server.test.mjs 集成测试，全部本地模拟，不产生付费 AI 调用
npm run demo      # 离线 heuristic CLI 演示
npm run score-demo # 合成加权计算演示（demoOnly）
```