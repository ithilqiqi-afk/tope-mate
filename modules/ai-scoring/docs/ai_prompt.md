# AI 评分提示词说明 v0.6.0

运行时系统提示词唯一来源为 `prompts/system_prompt.txt`，由 `src/provider.mjs` 读取。提示词版本：`tope_practice_prompt_v0.6.0`。

模型收到：
- 题型、阶段、题目、转写文本和时长；
- 用户上传的官方 B/C 1–6 级描述摘要（仅作定性评价锚点）；
- `practiceScoreConfig`：产品内部阶段权重、可评估维度、维度描述和 0–100 维度锚点。

模型必须：
1. 仅对 `assessedDimensions` 中的维度输出 0–100 整数分。
2. 对未评估维度输出 `null`。
3. 每个已评分维度给出理由和可核验的原文证据。
4. 不计算 `practiceScore`，不修改权重；总分由后端计算。
5. 不把产品分数描述成官方成绩或 1–6 级换算。
6. `timeManagement` 始终输出 `null`，由后端根据录音时长和目标时长计算。
7. 只有提供目标考生及至少一位其他考生的真实轮次，才评估 B discussion interaction；考官轮次不算组员互动证据。
8. 不从转写文本推断发音、语调、停顿或音频流利度。
9. PEEL 只在 B statement/C speech 作为辅助教学分析，不是独立评分项。

模型、提示词或评分算法版本变化时，历史比较键会随之变化，不建议直接比较跨版本分数。
