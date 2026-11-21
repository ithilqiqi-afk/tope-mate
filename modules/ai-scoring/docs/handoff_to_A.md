# 给同学 A 的对接说明（v0.6）

## 本次协议调整

B 模块在保留原请求字段和主要反馈字段的基础上，将响应升级到 `schemaVersion: 1.4.0`。

主要展示字段为：
- `practiceScore`：0–100 TOPE Mate 单阶段练习参考分（非官方，scope=`stage`）
- `scores`：阶段维度分数，缺证据时为 `null`
- `scoreStatus`：complete / partial / not_scored
- `scoreCoverage`：证据覆盖率及历史比较条件
- `dimensionFeedback`：维度分数、权重、理由和原文证据
- `strengths` / `weaknesses` / `suggestions`
- `evidence` / `peel` / `improvedExpressions` / `nextPractice`
- `officialAssessment.level` 永远为 null，不预测人大官方等级

`overall.score` 保留为兼容别名，等于 `practiceScore`。请将其 UI 标签改为“本阶段练习参考分”，不要显示“官方成绩”或“预测等级”。

## 产品评分与官方标准的关系

人大官方 1–6 级描述只作为定性锚点；产品的维度权重、0–100 分锚点及时间规则均为 TOPE Mate 内部初始设计，不是官方权重或官方等级换算。请展示非官方免责声明。

## 需要前端处理

1. `practiceScore === null` 时显示“暂无法生成练习参考分”，不要显示 0。
2. `scoreStatus === 'partial'` 时展示 `scoreCoverage.coveragePercent`，提示本次仅依据部分证据评分。
3. `scores.* === null` 时显示“未评估”，不要显示 0 分。
4. B discussion 无有效 `speakerTurns` 时，不显示互动能力分，并提示需要完整讨论轮次。互动证据统一规则：目标考生与另一位真实考生都要有非空发言；`examiner` 轮次不算同伴互动证据。
5. 没有 `targetDurationSeconds` 时，不显示时间控制分。
6. `officialAssessment.level` 不用于 UI 等级徽章；不展示官方等级预测。
7. 历史趋势仅对相同 `scoreCoverage.comparisonKey` 的记录进行直接比较；该键包含评分算法版本、提示词版本、模型标识、考试类型、阶段、证据覆盖维度和适用的目标时长。不同题目难度仍可能不同。
8. `dimensionFeedback` 可用于展示每个维度的分数、占比、解释和证据；中文标签见 `data/dimension_labels.json`。
9. 继续保留 PEEL 为辅助教学反馈，不把它作为官方评分维度。

## 评分规则版本

- 模块版本：`0.6.0`
- 响应 Schema：`1.4.0`
- Practice Score 算法：`practice_index_v1.0.0`
- 提示词：`tope_practice_prompt_v0.6.0`

## 服务端要求

调用真实 AI 时必须由服务端持有 API Key。浏览器只调用你们自己的评分服务端接口，不得直接向模型服务发送密钥。

## HTTP 接口联调（v0.6 新增）

B 模块已提供本地评分服务，详见 `http_integration.md`。

1. 启动：在 `modules/ai-scoring/` 下 `npm run serve`，默认 `http://127.0.0.1:3001`，仅监听回环地址。
2. 健康检查：`GET /health`。
3. 评分：`POST /api/evaluate`，请求体为上述协议字段，上限 128 KB。
4. 响应包裹：成功 `{success:true, data:<完整 v1.4.0 报告>, meta:{questionId, demoOnly:false}}`；失败 `{success:false, error:{code, message, retryable}}`。前端从 `data` 中取报告字段，渲染逻辑不变。
5. 阶段名映射由 A 完成：`intro` → `self_intro`，`presentation` → `statement`；题目对象拼接为 `question` 字符串，题目编号放 `questionId`（选填，≤128 字符，仅追踪用，不参与评分，回填在 `meta.questionId`）。
6. CORS 仅允许 `http://localhost:5173` 与 `http://127.0.0.1:5173`，支持 OPTIONS 预检。
7. 模式：`SCORING_MODE=heuristic`（默认，无 Key，`practiceScore` 恒为 null，不产生假分数）；`SCORING_MODE=ai` 需服务端配置对应服务商 Key：`SCORING_PROVIDER=openai` 用 `OPENAI_API_KEY`；`SCORING_PROVIDER=bailian`（阿里云百炼）用 `DASHSCOPE_API_KEY`，默认模型 `qwen3.8-flash`、`reasoning.effort=low`、超时 120 秒（`SCORING_TIMEOUT_MS` 可配），详见 `http_integration.md`。缺 Key 返回 503，模型错误 502，超时 504。错误时请展示 `error.message` 并按 `retryable` 决定是否提供重试按钮。
8. 联调样例在 `examples/http-success-heuristic.json`、`http-success-scored-demo.json`（合成 81 分演示，`meta.demoOnly:true`，UI 必须标注“演示数据”）、`http-error-empty-transcript.json`、`http-error-no-key.json`。真实接口默认不返回合成分数。
9. **真实评分耗时提醒**：真实模型调用实测约 60 秒（服务端超时上限 120 秒）。前端 fetch 超时请设置 ≥120 秒，提交后显示“评分中”加载态并禁用重复提交；服务端不会自动重试，每次重试都是一次新的模型请求。建议先用 heuristic 模式打通 UI，再切换 ai 模式联调。
