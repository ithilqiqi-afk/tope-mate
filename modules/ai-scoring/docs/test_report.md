# TOPE Mate B AI 评分模块 v0.6.0 自动测试报告

**本轮测试结果：73/73 通过，0 失败。**（原评分模块测试 41 项 + HTTP 集成测试 17 项 + 百炼适配测试 15 项）

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

## 百炼适配与超时治理测试覆盖（tests/bailian-provider.test.mjs，15 项，全部本地 fake fetch）

- 百炼请求指向北京 compatible-mode `/responses` 端点，使用嵌套式 `text.format.json_schema`，并发送 `reasoning:{effort:'low'}`；OpenAI 路径保持平铺格式、3600 token 上限，且不发送 `reasoning` 参数。
- `BAILIAN_MODEL` / `BAILIAN_BASE_URL` 环境变量覆盖与末尾斜杠归一化；`DASHSCOPE_API_KEY` / `SCORING_PROVIDER` 环境解析，输出不泄露密钥；缺 Key 返回 `API_KEY_MISSING` 且零网络调用。
- 含 reasoning 输出项的响应经 message `output_text` 正确解析，证据逐字校验不变；incomplete 与虚构引用一律 fail-closed。
- **默认超时：bailian 120 秒、openai 保持 45 秒；`SCORING_TIMEOUT_MS` 可覆盖，钳制 1000–120000ms，非法值回退服务商默认；显式 `timeoutMs` 优先于环境变量。**
- **超时真实中止行为：fake fetch 挂起直至 AbortSignal 触发，按配置时延返回 `PROVIDER_TIMEOUT`，模型调用次数恰为 1（HTTP 层同样验证）。**
- **无自动重试回归：openai 与 bailian 两条路径在 HTTP 500 下均只调用模型 1 次，不产生分数。**
- **timeManagement 一致性回归：后端已计时的维度不得再出现在 `unassessed`；未提供目标时长时仍保留在未评估列表。修复仅为 normalizeAIResult 的一行过滤，不改 Schema、权重或评分算法语义。**
- HTTP 层 bailian 模式 503 / 422 优先级 / 200 完整报告，`questionId` 不进入模型输入；health 结构不变。
- 测试环境隔离（tests/env-isolation.mjs）：测试启动时清除本机可能携带的真实服务商环境变量（SCORING_PROVIDER、BAILIAN_BASE_URL、密钥等），保证在已配置真实环境的开发机与干净 CI 上结果一致；需要环境值的测试用 withEnv 显式设置并还原。

## 错误优先级约定（/api/evaluate）

请求 JSON 解析与字段校验通过后依次判断：

1. transcript 为空或全空白 → **422 `EMPTY_TRANSCRIPT`**（优先于缺 Key，绝不调用模型）。
2. AI 模式缺少 API Key → **503 `API_KEY_MISSING`**。
3. 其余进入正常评分流程；非法字段仍返回 422 `INVALID_FIELD`。

## Demo 说明

- `npm run demo` 运行离线 heuristic 诊断。它只展示结构线索，不产生练习参考分，输出 `practiceScore: null` 是预期行为。
- `npm run score-demo` 使用人为设置的合成维度分数演示后端加权计算，输出示例 Practice Score 81。该数据仅演示算术逻辑，不是 AI 评分或学生成绩。

## 未完成的验证

2026-11-21 经用户批准共执行过**两次**真实百炼调用（qwen3.8-flash）。第一次（个人免费额度，默认思考强度）：本地 45 秒超时返回 504 `PROVIDER_TIMEOUT`；百炼侧审计日志确认该请求实际完成（HTTP 200，模型耗时 118.94 秒，首 Token 1.01 秒，总 Token 9791，输出约 7740），即本地提前中止、未收到报告。据此将百炼路径调整为 `reasoning.effort=low` + 默认 120 秒可配置超时。第二次（主办方团队 Key，effort=low）：**HTTP 200，响应 59.09 秒**，返回完整 v1.4.0 报告：practiceScore 81、scoreStatus complete、覆盖率 100%、6/6 维度反馈完整、全部证据逐字校验通过、`officialAssessment.level=null`、无发音/语调/官方等级评价。除这两次经批准的调用外，其余测试均为本地 fake fetch，不产生付费请求。尚需用同一模型和提示词对高/中/低回答进行盲评复核并收集重复评分结果，校准分数稳定性；不能据此宣称真实模型评分准确、稳定，或分数与人大官方等级存在统计对应关系。GitHub Actions 远程执行结果需在推送后另行确认。