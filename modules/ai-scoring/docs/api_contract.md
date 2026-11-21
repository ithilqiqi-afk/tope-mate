# 评分 API 合约 v1.4.0（Practice Score）

## 请求

请求字段沿用 v1.3.0，不改变 A 现有调用入口：

```json
{
  "examType":"C",
  "question":"...",
  "stage":"speech",
  "transcript":"...",
  "durationSeconds":176,
  "targetDurationSeconds":180,
  "rubric":"ruc_tope_official_bands_v1"
}
```

B 小组讨论可额外传 `assessedSpeaker` 和 `speakerTurns`。互动分只有在目标考生和至少一位其他参与者均有真实轮次时才计算。

## 响应新增字段

```json
{
  "schemaVersion":"1.4.0",
  "practiceScore":80,
  "scoreVersion":"practice_index_v1.0.0",
  "scoreStatus":"complete",
  "scorePolicy":{
    "version":"practice_index_v1.0.0",
    "promptVersion":"tope_practice_prompt_v0.6.0",
    "modelId":"gpt-4o-mini",
    "label":"TOPE Mate Practice Score",
    "scope":"stage",
    "scaleMin":0,
    "scaleMax":100,
    "weightBasis":"product_defined_not_official",
    "method":"weighted_average_of_assessed_dimensions_with_renormalization",
    "configuredWeights":{"relevance":30,"organization":15,"development":10,"language":25,"taskCompletion":10,"timeManagement":10},
    "disclaimer":"非人大官方成绩、官方等级换算或正式考试预测"
  },
  "scoreCoverage":{
    "configuredWeight":100,
    "assessedWeight":100,
    "coveragePercent":100,
    "assessedDimensions":["relevance","organization","development","language","taskCompletion","timeManagement"],
    "notAssessedDimensions":[],
    "comparisonKey":"practice_index_v1.0.0|tope_practice_prompt_v0.6.0|gpt-4o-mini|C|speech|development,language,organization,relevance,taskCompletion,timeManagement|target-180s",
    "comparisonNote":"仅直接比较评分版本、考试类型、阶段、证据覆盖和目标时长一致的练习；不同题目难度仍可能不同。"
  }
}
```

## 字段约定

- `practiceScore`：主要展示的 0–100 阶段练习参考分；不是完整 B/C 多阶段考试合成分。
- `scoreVersion`：分数算法版本；算法/权重变化必须升级。`scorePolicy.promptVersion` 和 `scorePolicy.modelId` 用于约束历史比较。
- `scoreStatus`：`complete`、`partial` 或 `not_scored`。
- `scorePolicy`：产品内部权重、算法和免责声明。
- `scoreCoverage`：参与计算的权重覆盖率、已评估/未评估维度和可比性键。
- `scores`：各维度 0–100 分；无法评价时为 `null`。
- `dimensionFeedback`：维度分数、权重、归一化权重、理由及原文证据。
- `overall.score`：兼容旧报告页的别名，等于 `practiceScore`；不能标记为官方成绩。
- `officialAssessment.level`：恒为 `null`；官方等级不由产品预测。

## 公式

`practiceScore = round(Σ(维度分数 × 对应产品权重) / Σ(已评估维度权重))`

未评估维度不按 0 分处理，而是排除并重新归一化。`scoreCoverage.coveragePercent` 反映实际计入分数的权重比例。

## 重要限制

- 权重是 TOPE Mate 产品内部初始权重，不是人大官方权重。
- 只有转写文本时，发音、语调、停顿和音频流利度为未评估。
- B 讨论缺少真实轮次时，互动维度为未评估。
- 没有 `targetDurationSeconds` 时，时间控制维度为未评估。
- 历史比较必须匹配 `scoreVersion`、`promptVersion`、`modelId`、`examType`、`stage`、已评估维度；若时间维度参与计算，还需匹配目标时长。不同题目的难度差异仍需提醒用户。
- API Key 只能配置在服务端，不能放进浏览器 JS 或 GitHub。
