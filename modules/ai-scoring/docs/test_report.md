# TOPE Mate B AI 评分模块 v0.6.0 自动测试报告

**本轮测试结果：58/58 通过，0 失败。**（原评分模块测试 41 项 + HTTP 集成测试 17 项）

## 测试环境与执行方式

- 本地实际测试版本：**Node.js v24.22.3**（高于项目最低要求 Node.js 18）。
- 本地环境无 npm 命令，使用 Node 可执行文件直接运行 `node --test tests/*.test.mjs`，与 `npm test` 脚本等价。
- GitHub Actions 远程执行（`.github/workflows/validate.yml` 的 `ai-scoring` job）配置为 ubuntu-latest + Node.js 22，在 `modules/ai-scoring` 目录运行 `npm test`，不需要 API Key。**远程结果以 GitHub Actions 实际运行为准，本报告记录的是本地结果，两者尚未互相替代。**原有前端 `validate` job 保持不变，两个 job 相互独立。

## 执行命令

```bash
npm test            # 本地等价：node --test tests/*.test.mjs
npm run demo        # 本地等价：node src/cli.mjs --mode heuristic fixtures/official_c_honesty_speech.json
npm run score-demo  # 本地等价：node src/score-demo.mjs
```

demo 输出 `mode: heuristic`、`practiceScore: null`、`schemaVersion: 1.4.0`；score-demo 输出 `demoOnly: true`、合成 Practice Score 81。均为预期行为。

## 评分模块测试覆盖（tests/scoring.test.mjs、tests/official_rating.test.mjs，41 项）

- 官方 B/C 用户上传评分表截图中的 1–6 级摘要结构与 B/C 样题字段。
- 官方标准摘要与产品内部 0–100 Practice Score 的明确区分。
- B/C 各阶段产品权重总和为 100，且机器可读 policy 与运行时代码保持一致；明确标注非官方权重。
- AI 仅返回维度分；Practice Score 由后端固定权重计算。
- 未评估维度为 `null`，不按 0 分处理，并按已评估权重重新归一化。
- 时间分仅在提供目标时长时计算，且由后端固定产品规则计算。
- B 小组讨论必须同时提供目标考生和至少一位其他考生的真实非空轮次；只有考官轮次不构成同伴互动证据（contract 与 practice-score 使用同一共享判断函数）。
- 原文证据引用必须逐字来自转写或已提供的说话人轮次。
- `officialAssessment.level` 始终为 `null`，模型不能返回官方等级或总分。
- 历史比较键包含评分算法版本、提示词版本、模型标识、考试类型、阶段、已评估维度和适用目标时长；当前分数为单阶段练习分，不是完整 B/C 多阶段合成分。
- 模型拒绝、无 API Key、HTTP 错误、网络错误和超时均有结构化处理。
- 系统提示词唯一来源为 `prompts/system_prompt.txt`，防止文档提示词与运行时提示词不一致。

## HTTP 集成测试覆盖（tests/http-server.test.mjs，17 项，全部本地模拟）

- `GET /health` 返回 200，含模式、Schema 版本与模块版本；`aiKeyConfigured` 仅为布尔值。
- `POST /api/evaluate` 正常请求返回完整 v1.4.0 报告对象（`data`）与 `meta.questionId` / `meta.demoOnly`。
- 非法 JSON → 400 `INVALID_JSON`；请求体超过 128 KB → 413 `PAYLOAD_TOO_LARGE`。
- 空或全空白 transcript → 422 `EMPTY_TRANSCRIPT`，不产生评分结果。
- 非法字段（阶段、考试类型、时长、question 等）→ 422 `INVALID_FIELD`。
- AI 模式缺 API Key → 503 `API_KEY_MISSING`，不调用模型、不伪造分数。
- **错误优先级回归：AI 模式且缺 Key 时，空字符串与全空格 transcript 均优先返回 422 `EMPTY_TRANSCRIPT`（而非 503），断言无评分结果且模型调用次数为 0。**
- `questionId` 校验（空串、超 128 字符、非字符串 → 422），合法值回填 `meta.questionId`，且不出现在发给模型的输入中。
- examiner 轮次不算 B 讨论同伴互动证据；空文本同伴轮次同样不构成证据；HTTP 响应中互动维度为 null 并列入未评估。
- 模型输出携带官方等级 → 502 `INVALID_MODEL_OUTPUT`，不返回分数（不允许虚构官方等级）。
- heuristic 模式 `practiceScore`、`overall.score` 与全部维度分恒为 null（离线模式不伪造分数）；AI 成功报告 `officialAssessment.level` 仍为 null。
- 模型超时 → 504 `PROVIDER_TIMEOUT`；模型服务 HTTP 错误 → 502 `PROVIDER_HTTP_ERROR`。
- CORS 仅允许 `http://localhost:5173` 与 `http://127.0.0.1:5173`，OPTIONS 预检 204，非白名单来源预检 403 且无 CORS 头。
- 未知路径 404、错误方法 405，均为结构化错误。
- 错误响应不泄露密钥、内部异常堆栈或请求转写数据。
- examples/ 四个固定联调样例为有效 JSON，heuristic 样例分数为 null，scored-demo 样例 `demoOnly: true` 且含非官方免责声明。

## 错误优先级约定（/api/evaluate）

请求 JSON 解析与字段校验通过后依次判断：

1. transcript 为空或全空白 → **422 `EMPTY_TRANSCRIPT`**（优先于缺 Key，绝不调用模型）。
2. AI 模式缺少 API Key → **503 `API_KEY_MISSING`**。
3. 其余进入正常评分流程；非法字段仍返回 422 `INVALID_FIELD`。

## Demo 说明

- `npm run demo` 运行离线 heuristic 诊断。它只展示结构线索，不产生练习参考分，输出 `practiceScore: null` 是预期行为。
- `npm run score-demo` 使用人为设置的合成维度分数演示后端加权计算，输出示例 Practice Score 81。该数据仅演示算术逻辑，不是 AI 评分或学生成绩。

## 未完成的验证

本轮没有配置 API Key，没有调用任何真实付费模型（HTTP 测试中的 AI 路径全部使用本地 fake fetch），也没有进行真人考官对照。因此不能据此宣称真实模型评分准确、稳定，或分数与人大官方等级存在统计对应关系。后续需用同一模型和提示词，对高/中/低回答进行盲评复核，并收集多次重复评分结果，校准分数稳定性。GitHub Actions 远程执行结果需在推送后另行确认。