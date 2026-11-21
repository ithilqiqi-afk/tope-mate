# TOPE Mate · 同学 B AI 评分模块 v0.6（练习参考分版）

本版本在 v0.5 的官方评分依据和证据保护机制上，新增 TOPE Mate 内部 0–100 `Practice Score`，用于同类练习的趋势比较；当前分数按单个考试阶段计算，不是完整 B/C 多阶段考试的合成总分。

## 重要定位

- 人大官方 B/C 1–6 级评分描述继续作为定性评价锚点。
- `practiceScore` 是产品内部练习参考分，不是人大官方成绩、官方等级换算或正式考试预测。
- 产品内部维度权重、0–100 锚点和时间规则不是人大官方权重。
- AI 只对有证据的维度给分；总分由后端按固定权重计算。
- 未评估维度为 `null`，不按 0 分处理；总分按已评估维度权重重新归一化。
- `officialAssessment.level` 永远为 `null`。
- 只有转写文本时不评估发音、语调、停顿和音频流利度；B 讨论没有真实轮次时不评估互动。

## 本地运行

需要 Node.js >=18，无第三方运行依赖：

```bash
npm test
npm run demo
node src/cli.mjs --mode heuristic fixtures/official_b_pressure_discussion.json
node src/cli.mjs --mode mock fixtures/official_c_honesty_qa.json
npm run score-demo
```

真实模型调用（服务端）需设置 `OPENAI_API_KEY`，然后：

```bash
node src/cli.mjs --mode ai fixtures/official_c_honesty_speech.json
```

本次开发和自动测试不需要真实 API Key，也未进行付费调用。不要把密钥写入前端 JS 或提交到 GitHub。

## 文件导航

- `data/official_rating_descriptors.json`：用户提供官方评分表截图的 1–6 级描述摘要。
- `data/official_sample_questions.json`：用户提供的 B Pressure / C Honesty 样题结构。
- `data/practice_score_policy.json`：机器可读的产品内部练习分政策、权重和可比性规则。
- `data/dimension_labels.json`：前端维度中文标签及未评估状态文案。
- `src/practice-score.mjs`：阶段权重、维度可用性、时间规则、版本可比性和总分计算。
- `src/score-demo.mjs`：明确标注为合成数据的分数计算演示。
- `src/provider.mjs`：服务端模型调用与结构化响应归一化。
- `docs/practice_score_methodology.md`：分数定位、公式、权重和可比性说明。
- `docs/api_contract.md`：v1.4.0 API 合约。
- `docs/handoff_to_A.md`：前端接入要求。
- `fixtures/`：高中低样例及官网样题相关测试文本。

## 版本说明

- Module: `0.6.0`
- Schema: `1.4.0`
- Score algorithm: `practice_index_v1.0.0`
- Prompt: `tope_practice_prompt_v0.6.0`
- Official rubric basis: `ruc_tope_official_bands_v1`
