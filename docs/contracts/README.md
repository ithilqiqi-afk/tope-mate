# 接口契约

## 状态：评分协议已冻结在 Schema 1.4.0

权威定义在 B 的模块里，本目录是 A 侧的对齐副本与样例库：

| 内容 | 权威来源 |
| --- | --- |
| 评分请求/响应字段与算法 | [`modules/ai-scoring/docs/api_contract.md`](../../modules/ai-scoring/docs/api_contract.md) |
| 请求校验实现 | `modules/ai-scoring/src/contract.mjs` → `validateRequest()` |
| 报告对象结构 | `modules/ai-scoring/src/{contract.mjs,ai-schema.mjs,practice-score.mjs}` |
| HTTP 传输层与状态码 | `modules/ai-scoring/src/http-server.mjs`、[`modules/ai-scoring/docs/http_integration.md`](../../modules/ai-scoring/docs/http_integration.md) |
| 交接说明 | [`modules/ai-scoring/docs/handoff_to_A.md`](../../modules/ai-scoring/docs/handoff_to_A.md) |
| 语音转写接口 | [`modules/speech-transcription/docs/transcribe_api.md`](../../modules/speech-transcription/docs/transcribe_api.md) |

本目录的 JSON Schema 只是可读镜像。两者不一致时**以 `modules/ai-scoring/src/` 的实现为准**，并同步修本目录。

## v0.1 候选协议已废弃

`docs/contracts/` 早期放的是双方对齐前的候选规范（`version:"0.1.0"`），与 1.4.0 **不兼容**，已作废：

| v0.1 候选（不要再用） | Schema 1.4.0（现行） |
| --- | --- |
| `question` 是 `{id,text,candidateKey,discussion}` 对象 | `question` 是英文题干字符串；追踪标识改用可选 `questionId` |
| `rubric` 是对象 | `rubric` 是版本标签字符串或 `null` |
| `stage` 直接接受 A 侧的 `intro`/`presentation` | 只接受 `self_intro`/`statement`/`discussion`/`speech`/`qa`，映射在前端完成 |
| 响应 `scores.overall` + `scores.dimensions` | `practiceScore` + `scores.<维度>` + `scorePolicy`/`scoreCoverage`/`dimensionFeedback` |
| 响应 `evidence[].comment` | `evidence[].observation` + `evidence[].dimension` |
| 响应 `peel` 可为 `null`、字段名 `notAssessed` | `peel` 四键恒为状态枚举、字段名 `unassessed` |
| `version:"0.1.0"` | `schemaVersion:"1.4.0"` |

**不得把旧报告数据结构当成真实评分响应**；前端渲染只认 1.4.0 的 `{success,data,meta}` 信封。

`question-b.schema.json` / `question-c.schema.json` 与评分协议无关，仍是 A 侧题库的兼容说明。

## A 侧阶段映射

| A 内部阶段键 | 提交给评分服务的 `stage` |
| --- | --- |
| `intro` | `self_intro` |
| `presentation` | `statement` |
| `discussion` | `discussion` |
| `speech` | `speech` |
| `qa` | `qa` |
| `prepare` | 不提交评分（无口头产出） |

## 文件

- `evaluation-request.schema.json`：评分请求（含 B 讨论的 `assessedSpeaker` / `speakerTurns`）。
- `evaluation-response.schema.json`：HTTP 信封 + 完整报告对象，附前端渲染硬性规则。
- `evaluation-error.schema.json`：失败信封，评分与转写两个服务共用错误码表。
- `fixtures/`：由 `node tools/make-contract-fixtures.mjs` 调用 B 的生产函数生成，不是手写的理想样例。
  - `evaluation-request.sample.json`：C 演讲，带目标时长。
  - `evaluation-request-b-discussion.sample.json`：B 讨论，故意**不**带真实轮次。
  - `evaluation-response.sample.json`：`mode:"ai"`、`scoreStatus:"complete"`、覆盖率 100%。
  - `evaluation-response-partial.sample.json`：`scoreStatus:"partial"`、覆盖率 75%、`scores.interaction` 为 `null`。
  - `evaluation-error.sample.json`：缺 Key 的失败响应。
  - 样例文本均为虚构练习内容，不代表真实考生表现，也不代表已做过真实 AI 评价。

## 校验

```powershell
node tests/validate.cjs     # 同时校验本目录样例与 modules/ai-scoring/examples 的 1.4.0 结构
node tools/make-contract-fixtures.mjs   # 需要重新生成样例时
```

## 不变的边界

- `practiceScore` 是**单阶段**练习参考分，不是整场考试合成分，也不是人大官方成绩或等级。
- `officialAssessment.level` 恒为 `null`。
- 只有转写文本时，发音、语调、音频流利度恒为未评估。
- 没有带说话人标签的真实轮次时，互动维度为未评估（`examiner` 不算同伴）。
- 没有 `targetDurationSeconds` 时，时间控制维度为未评估。
- API Key 只在服务端环境变量里，不进浏览器代码、不进 Git、不进日志。
