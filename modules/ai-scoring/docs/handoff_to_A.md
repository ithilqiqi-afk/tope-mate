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
4. B discussion 无 `speakerTurns` 时，不显示互动能力分，并提示需要完整讨论轮次。
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
