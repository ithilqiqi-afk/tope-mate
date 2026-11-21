# TOPE Mate 第五轮补丁交付：阿里云百炼 API 兼容适配与真实 AI 联调准备

日期：2026-11-21　分支：`feature/ai-integration`（与任务书要求一致，未切换）
基线 HEAD：`08c04cd  Merge pull request #2 from ithilqiqi-afk/feature/ai-scoring`
本轮**未 commit、未 push、未建 PR、未合并 `main`、未部署、未产生任何付费调用**；全部改动留在工作区。
第 1–10 节是第五轮补丁原文，**第 11 节是同日的兼容性补丁**（对齐成员 B 的真实实测结果），第 1–10 节里凡被补丁改掉数字的地方都已就地更新。

> 分层结论先说在前面：本方（Qoder）两轮都只完成**第 1 层（离线模拟 + 零 Key 实机）**。所有测试用的都是伪造密钥与伪造录音，
> **本方没有发起过一次真实百炼调用**，因此不能宣称「真实转写」或「真实 AI 评分」已由本方验证通过。
> 唯一已知的真实调用来自**成员 B 的外部报告**（评分侧，Schema 1.4.0 通过，59.09 秒），本方据此调整配置但未复现；
> **ASR 侧至今零真实调用**，最小范围的一次冒烟已准备就绪、等用户批准（第 9.5 节）。

---

## 1. 北京地域 API 核实结果与参考链接

全部结论以阿里云百炼官方文档为准（逐页抓取，非按模型名推测）：

| 项目 | 核实结论 | 依据 |
| --- | --- | --- |
| Chat 端点（评分） | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`；业务空间专属域名是官方推荐形态 | [OpenAI兼容-Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| Responses 端点（评分，**成员 B 实测通过的那条**） | `POST {Base URL}/responses`，`qwen3.8-flash` 在官方 Responses 支持列表内；`store` 默认 `true`（本实现固定 `false`）、`reasoning.effort` 档位 `none/low/medium/high/xhigh`（该模型默认 `xhigh`，即 59 秒耗时的来源）、达上限时 `status:"incomplete"` | [创建响应](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses) |
| 通用域名 | `https://dashscope.aliyuncs.com/compatible-mode/v1` **可用且无需 `{WorkspaceId}`**——成员 B 已用团队 Key 在该地址真实调用成功（见第 11 节），本实现把它设为内置默认 Base URL | 同上、[OpenAI兼容-Chat](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)（「现有域名仍可正常使用」） |
| 地域与 Key | 地域与 API Key 绑定，跨地域调用返回 401；北京与新加坡的 Key 不同 | [获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)、[错误码](https://help.aliyun.com/zh/model-studio/error-code) |
| 结构化输出 | 支持 `response_format:{type:"json_schema",json_schema:{name,strict:true,schema}}`，**Qwen3.8-Flash 系列在官方支持列表内**；开启结构化输出时**不得设置 `max_tokens`** | [结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output) |
| Schema 关键字 | 支持 `anyOf/oneOf/allOf/not`；不支持 `multipleOf`、数组 `uniqueItems/contains`、对象 `patternProperties/propertyNames` 等 | 同上 |
| ASR 端点（转写） | 百炼**不存在** `/audio/transcriptions`；`qwen3-asr-flash` 走 `chat/completions`，音频放在 `messages[0].content[0] = {type:"input_audio", input_audio:{data:<公网 URL 或 Base64 Data URI>}}`，结果在 `choices[0].message.content` | [Qwen-ASR HTTP API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference) |
| 本地文件路径 | 官方明确「不支持直接传入本地文件绝对路径」→ 本实现只把内存里的录音编码成 Data URI | 同上 |
| ASR 限制 | 单次 1 个音频；**Base64 编码后 ≤ 10 MB**；**时长 ≤ 5 分钟**；非 PCM 采样率不限、服务端重采样 16 kHz | 同上、[非实时语音识别](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) |
| ASR 参数 | `asr_options.language` 无默认值（取值表内代码，混合语种应省略）、`asr_options.enable_itn` 默认 `false`（仅中英） | [Qwen-ASR HTTP API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference) |
| 错误码 | 401 `Invalid API-key`/`invalid_api_key`、403 `AccessDenied`/`BailianGateway.Workspace.NotAuthorised`、404 `ModelNotFound`、429 `Throttling.*`/`insufficient_quota`、`Arrearage`、400 `InvalidParameter`/`The product is not activated`、5xx `InternalError`/`ServiceUnavailable`；音频过短报 `The audio is empty` | [错误码](https://help.aliyun.com/zh/model-studio/error-code) |
| 模型清单接口 | `GET {Base URL 同级}/api/v1/models`，支持 `features=structured-outputs` 过滤，可用于确认某业务空间实际开通了哪些模型 | [列出模型](https://help.aliyun.com/zh/model-studio/list-models) |

`{WorkspaceId}` 一律不作为真实值出现在代码、`.env.example` 或本文件里。**补丁后已不需要它**：默认 Base URL 就是成员 B 实测通过的 dashscope 地址，用户留空即可；只有主动填业务空间专属域名时才必须换成控制台里的真实 ID，而带 `{WorkspaceId}` 占位符的配置会被拒绝并给出 503。

---

## 2. 两个候选模型的可用性结论

**评分：`qwen3.8-flash`（华北2·北京）— 已有一次真实调用通过**
- 官方模型页列出的限制：最大输入 991,808 tokens、最大输出 131,072 tokens、上下文 1,000,000、思维链上限 262,144。
- 价格口径：输入 0.8 元/百万 tokens、输出 2.7 元/百万 tokens、缓存命中 0.1 元/百万 tokens（**以控制台当日价格页为准，本文件不作为计费依据**）。
- **成员 B 实测（2026-11-21）**：dashscope 地址 + `/responses` + 团队 Key，HTTP 200、耗时 **59.09 秒**、返回 Schema 1.4.0 报告且原文证据校验通过。耗时来自思考档位默认 `xhigh`。
- 因此本轮把评分百炼通路的**默认接口切成 `responses`**（报文逐字段镜像 B 实测通过的形态），`chat/completions` 保留为可用 `BAILIAN_SCORING_TRANSPORT=chat` 切换的备用通路；`enable_thinking:false` 只在 chat 通路生效，responses 通路改用 `BAILIAN_SCORING_REASONING_EFFORT` 控档（默认不下发，保持与实测一致）。
- 结论：**接口形态、结构化输出能力与本项目的 Schema 1.4.0 校验完全兼容**，且已由真实调用证实；无需修改评分算法即可迁移。

**转写：`qwen3-asr-flash`（华北2·北京）**
- 计费口径：0.00022 元/秒，不足 1 秒按 1 秒计；文档提到北京地域有 36,000 秒（10 小时、90 天）免费额度——**是否已到账必须在控制台确认，本项目未做任何额度操作**。
- 支持格式含 `webm/opus/ogg/wav/mp3/mpeg/flac/amr/aac/avi/aiff/flv/mkv/wma/wmv`，**不含 `m4a/mp4/mov`**。
- 成员 B 的口径与官方文档一致：**北京地域可用、支持英文与 WebM、单次 5 分钟 / Base64 后 10 MB**；但**这把团队 Key 是否已开通 `qwen3-asr-flash` 尚未真实验证**——本轮只做了一次零出网的 `--dry-run`（第 11.5 节），真实 ASR 调用仍待批准。
- 结论：**Chrome / Edge 的 WebM(Opus) 录音可用**；**Safari 的 MediaRecorder 产物（mp4/m4a 容器）在这条通路上走不通**，服务会返回 415 并给出明确提示。官方另列的替代模型 `qwen-audio-3.1-asr-flash` 支持 m4a，但**只走 DashScope 原生协议、不支持 OpenAI 兼容协议**，属于新增传输层，超出本轮「最小兼容修复」范围，未实施。

**仍未确认、必须留待真实验收或用户核对的项目**
1. 这把 Key 所属业务空间是否已开通 `qwen3-asr-flash`（评分可用**不代表**转写可用，两模型权限不默认相同）；`{WorkspaceId}` 本身在补丁后不再是必填项。
2. 现有 `AI_SCHEMA` 里的 `{type:"null"}` 字段（`practiceScore`、`overall.score`、`scores.timeManagement` 等）是否被 `strict:true` 完全接受——**B 的 `/responses` 实测已返回通过证据校验的 1.4.0 报告，等价于在这条通路上验过了**；chat 通路仍未真实验证。
3. 思考档位对评分质量与耗时的影响：实测 59.09 秒对应默认 `xhigh`；降档（`medium`/`low`）会更快更省，但**输出风格会变，必须重新做一次真实验收**，本轮只做了代码与配置适配。
4. 真实 401/403/404/429 报文形态与重试行为（B 的调用是成功分支，失败分支仍只有离线模拟）。

---

## 3. 实际新增与修改的文件

新增（8 个，其中补丁新增 2 个：`bailian-responses.test.mjs` 与 `tools/asr-smoke.mjs`）
- `modules/ai-scoring/src/bailian-provider.mjs` — 评分侧百炼通路；**补丁后默认 `responses`**（镜像成员 B 实测报文），`chat` 保留为可切换备用通路。
- `modules/speech-transcription/src/bailian-provider.mjs` — 转写侧百炼通路（`input_audio` + Base64 Data URI，仍走 `chat/completions`）。
- `modules/ai-scoring/tests/bailian-provider.test.mjs`（14 项，补丁后钉住 `transport:'chat'`）
- `modules/ai-scoring/tests/bailian-http.test.mjs`（10 项，补丁后同样钉 `chat` 通路）
- `modules/ai-scoring/tests/bailian-responses.test.mjs`（**补丁新增，18 项**）
- `modules/speech-transcription/tests/bailian-provider.test.mjs`（19 项 = 原 16 + 补丁新增 3：默认 dashscope 地址、留空即用、显式留空视为配置缺失）
- `modules/speech-transcription/tests/bailian-http.test.mjs`（13 项）
- `tools/asr-smoke.mjs`（**补丁新增**，最小真实 ASR 调用准备脚本，零依赖、不读 Key、`--dry-run` 完全离线）

修改（7 组，共 9 个文件）
- `modules/ai-scoring/src/http-server.mjs` — `PROVIDERS`/`resolveProvider`、`SCORING_PROVIDER` 分发、百炼 Key/模型/Base URL/思考开关参数、`/health` 增 `provider` 与真实模型名、错误表补 3 个 code、启动前配置警告（只报有无，不打印密钥）、`SCORING_TIMEOUT_MS` 生效。
- `modules/speech-transcription/src/http-server.mjs` — 同上结构 + `TRANSCRIBE_PROVIDER` 分发；bailian 通路上传上限折算为 7,863,552 B；`/health` 增 `maxAudioSeconds:300` 与 5 项格式白名单；错误表补 `AUDIO_TOO_LONG`/`PROVIDER_CONFIG_ERROR`/`PROVIDER_AUTH_ERROR`/`PROVIDER_MODEL_UNAVAILABLE`；把 `meta.durationSeconds` 传给模型层。
- `modules/ai-scoring/.env.example`、`modules/speech-transcription/.env.example` — 补 provider、百炼 Key、Base URL（含 `{WorkspaceId}` 占位说明）、模型名、思考/ITN 开关、超时；全部只留空值或占位符。
- `config/exam-config.js` — 两个 `*Provider` 展示串改为如实说明「由服务端环境变量决定」，并注明真实值以 `/health` 的 `data.provider` 为准。
- `services/evaluation.js` — `STATUS_BY_CODE` 补 `PROVIDER_AUTH_ERROR→no_key`、`PROVIDER_MODEL_UNAVAILABLE→provider`、`PROVIDER_CONFIG_ERROR→bad_endpoint`、`PROVIDER_INCOMPLETE→bad_model_output`、`INVALID_FIELD→bad_request`（是否可重试仍以后端 `error.retryable` 为准）。
- `tools/serve-with-env.cmd` — Key 状态提示不再只认 `OPENAI_API_KEY`，`BAILIAN_API_KEY`/`DASHSCOPE_API_KEY` 也算已配置（仍是 ASCII + CRLF）。
- 本文件 + `docs/PROJECT_STATUS.md`。

补丁追加修改（成员 B 实测结果回来后，共 8 个文件）
- `modules/ai-scoring/src/bailian-provider.mjs` — 整文件重写：新增 `BAILIAN_TRANSPORTS`/`DEFAULT_BAILIAN_TRANSPORT='responses'`/`resolveBailianTransport`/`bailianResponsesUrl`/`bailianUrlFor`、`DEFAULT_BAILIAN_BASE_URL` 指向实测通过的 dashscope 地址、responses 报文与 B 的实测形态逐字段同构（`store:false`、`instructions`、`input` 字符串、嵌套 `text.format.json_schema`、`max_output_tokens:3600`）、`reasoning.effort` 可选下发、`status:'incomplete'` 与 `finish_reason:'length'` 双形态截断拦截、`output_text`/`output[]` 双形态解析。
- `modules/ai-scoring/src/http-server.mjs` — 默认超时 45000→**120000**；新增 `bailianTransport`/`bailianReasoningEffort` 参数与非法值 `exit(1)`；`/health` 增 `transport`、`timeoutMs`；listening 行打印 transport 与 timeout；新增「`SCORING_TIMEOUT_MS` < 60000 小于实测约 59 秒」告警；`PROVIDER_CONFIG_ERROR` 文案改为「默认地址已实测可用」。
- `modules/speech-transcription/src/bailian-provider.mjs` — 新增 `DEFAULT_BAILIAN_BASE_URL`（与评分同 host，无需 `{WorkspaceId}`）并作为参数默认值；`bailianChatUrl` 会剥掉尾部 `/chat/completions|/responses` 再拼正确路径；默认超时 60000→**90000**。
- `modules/speech-transcription/src/http-server.mjs` — `TRANSCRIBE_TIMEOUT_MS` 默认 90000；`/health` 增 `timeoutMs`；占位符告警改为提示留空即用实测地址。
- `config/exam-config.js` — `requestTimeoutMs` 改为 `transcribe:120000`、`evaluate:150000`，并写明「前端超时必须大于服务端超时」与 59.09 秒实测依据。
- `services/evaluation.js` — 读不到配置时的回退超时 60000→150000；`services/transcription.js` — 回退 75000→120000（两处都只动回退常量，逻辑不变）。
- 两份 `.env.example` — 补 `BAILIAN_SCORING_TRANSPORT`、`BAILIAN_SCORING_REASONING_EFFORT`，把 `BAILIAN_BASE_URL` 说明改成「留空即用实测地址」，超时注释同步为 120000/150000 与 90000/120000 的新链路。
- 本文件 + `docs/PROJECT_STATUS.md`（同步实测事实与补丁说明）。

前端 `app.js`、`services/ai-pipeline.js`、题库与页面结构**两轮都未改动**：供应商切换发生在服务端，前端契约不变。补丁只在 `services/evaluation.js`/`services/transcription.js` 各改了一个超时回退常量（第 3 节末），`services/transcription.js` 的其余逻辑与第五轮一致。

---

## 4. 是否改动了成员 B 的评分核心逻辑

**没有。** 逐项说明：
- `modules/ai-scoring/src/provider.mjs` 的 `normalizeAIResult`、`SYSTEM_PROMPT`，`rubrics.mjs`、`practice-score.mjs`、`contract.mjs`、`ai-schema.mjs`、`scorer.mjs` 本轮**一个字节都没改**；百炼通路直接 `import` 它们。
- 聚合练习分仍只由后端 `calculatePracticeScore` 计算；模型自带总分、自带官方等级、编造原文证据 → 一律 `INVALID_MODEL_OUTPUT`，前端显示失败而不是采用分数。
- 新增的 parity 测试「同一份模型输出经百炼与 OpenAI 通路得到逐字段一致的报告」用 `assert.deepEqual` 比较两条通路的完整报告对象，**通过**，证明只换传输层、未动算法。
- 外部接口未变：`POST /api/evaluate`、`GET /health`、字段与 Schema 1.4.0、权重与证据校验、无法评估维度处理、练习参考分与人大官方等级区分（`officialAssessment.level` 恒为 `null`）全部保持。
- 唯一的兼容性补充：百炼文档要求「开启结构化输出时不要设置 `max_tokens`」，因此 **chat 通路不下发任何 token 上限参数**，由 `finish_reason === "length"` → `PROVIDER_INCOMPLETE` 拦住被截断的输出；**responses 通路保留 `max_output_tokens:3600`**（与仓库 OpenAI 通路 `provider.mjs` 和成员 B 实测通过的报文一致），截断由 `status:"incomplete"` 拦下。若真实验收显示百炼 Responses 不接受该参数，删掉这一行即可，属于一处字段的改动，不需要动算法。

补丁后与成员 B 代码的合并注意（重要）
- 本模块 `src/bailian-provider.mjs` 的 responses 分支与 B 在 `src/provider.mjs` 里的 `scoreWithOpenAI` 报文**形态相同但各写一份**（前者打百炼域名、后者打 OpenAI 域名）。B 的最新评分代码同步进来后**以 B 为准**：如果他抽出了公共的报文构造函数，应删掉百炼文件里的重复分支改为复用，而不是让两份 responses 报文各自漂移。
- 判定复用是否成功的验收标准已经写成测试：`bailian-responses.test.mjs` 里的三通路 `deepEqual` parity 用例（同一份模型输出经 OpenAI / 百炼 responses / 百炼 chat 得到逐字段一致的报告）。合并后这条测试若挂，说明 B 的算法或归一化被改动，需要先对齐再合。
- B 本轮改动仍在 `provider.mjs`/`rubrics.mjs`/`practice-score.mjs` 等工作区文件里，我没有覆盖它们；合并冲突时应保留 B 的版本，只在百炼传输层适配。

---

## 5. Windows 本地运行与配置方式

三个端口不变：`5173` 页面、`3001` 评分、`3002` 转写；AI 服务只监听 `127.0.0.1`，CORS 白名单仍只有 `http://localhost:5173` 与 `http://127.0.0.1:5173`。

```
1) 双击  启动预览.bat                      （Vite，5173）
2) 双击  启动 AI 后端.bat                  （一个窗口 3001、一个窗口 3002）
3) 浏览器打开 http://localhost:5173
4) 停止：双击 停止 AI 后端.bat，核对列出的 PID 后手动输入 Y
```

两家的 `.env`（`modules/ai-scoring/.env`、`modules/speech-transcription/.env`）由启动器
`tools/serve-with-env.cmd` 经 `tools/env-lines.mjs` 加载：
- 新增的百炼变量**不需要改启动脚本**（加载器用危险变量黑名单，`PATH`/`NODE_OPTIONS`/`ComSpec` 等一律拒绝覆盖）；
- 键与值必须是 ASCII，含中文的行会被跳过并提示；临时批处理用完即删；
- 不填 `.env` 也能启动：评分走 `heuristic`、转写在调用时返回 503，前端只显示失败原因。

**本轮实测（伪造 Key、伪造录音、零真实调用）**：用同一套启动器把两个服务临时起在 `3101/3102`（不碰用户自己的 `3001/3002`），启动输出正常、无 CMD 语法报错：

```
[TOPE Mate] scoring  port: http://127.0.0.1:3101 (loopback only...)
[TOPE Mate] scoring  API key: not set - the service answers with a clear error instead of made-up results
警告：SCORING_MODE=ai 但未配置 BAILIAN_API_KEY 或 DASHSCOPE_API_KEY，/api/evaluate 将返回 503。
TOPE Mate scoring server (ai, provider=bailian) listening on http://127.0.0.1:3101
```

健康检查与错误路径实测：

```
GET  :3101/health → {"mode":"ai","provider":"bailian","schemaVersion":"1.4.0",
                     "aiKeyConfigured":false,"model":"qwen3.8-flash"}
GET  :3102/health → {"provider":"bailian","model":"qwen3-asr-flash","keyConfigured":false,
                     "maxAudioBytes":7863552,"maxAudioSeconds":300,
                     "allowedFormats":["webm","ogg","wav","mp3","flac"]}
POST :3101/api/evaluate（无 Key）        → 503 API_KEY_MISSING
POST :3102/api/transcribe（无 Key）      → 503 API_KEY_MISSING（消息点名 BAILIAN_API_KEY）
POST 两个接口（有伪造 Key、Base URL 仍含 {WorkspaceId}）
                                        → 503 PROVIDER_CONFIG_ERROR，且未发出任何外部请求
```

⚠️ 现在仍在运行的 `3001/3002` 是**本轮改动之前**启动的进程。2026-11-21 收尾时实测过它们的 `/health`：
`3001` 仍是 `{"mode":"heuristic", ...}` 且没有 `provider`/`transport`/`timeoutMs` 字段，`3002` 仍是 `provider:"openai"`、`model:"gpt-transcribe"`、白名单里还带着 `m4a/flac`——两处都是旧代码的形状。
要体验百炼通路必须先关掉旧窗口再双击 `启动 AI 后端.bat`（或双击 `停止 AI 后端.bat` 核对 PID 后停止）。我没有代关，避免误杀无关进程。

### 5.1 补丁后的启动实测（仍为零 Key、零真实调用）

补丁改了超时默认值与 startup 输出，所以重新起了一次实测。这次直接以模块入口 + 环境变量临时起在 `3901/3902/3903`（不经过 `.env`、不碰用户的 `3001/3002/5173`），验证完即逐个 `taskkill` 关掉，端口现已释放：

```
SCORING_MODE=ai SCORING_PROVIDER=bailian SCORING_TIMEOUT_MS=20000 PORT=3901
  警告：SCORING_MODE=ai 但未配置 BAILIAN_API_KEY 或 DASHSCOPE_API_KEY，/api/evaluate 将返回 503。
  警告：SCORING_TIMEOUT_MS=20000 小于真实调用的实测耗时（约 59 秒），建议至少 120000。
  TOPE Mate scoring server (ai, provider=bailian, transport=responses, timeout=20000ms) listening on http://127.0.0.1:3901

TRANSCRIBE_PROVIDER=bailian TRANSCRIBE_TIMEOUT_MS=5000 PORT=3902
  警告：未配置 BAILIAN_API_KEY（或 DASHSCOPE_API_KEY），/api/transcribe 将返回 503，不会产生任何伪造的转写文本。
  TOPE Mate transcription server (provider=bailian) listening on http://127.0.0.1:3902

SCORING_PROVIDER=bailian BAILIAN_BASE_URL='https://{WorkspaceId}...' PORT=3903
  警告：BAILIAN_BASE_URL 里仍是 {WorkspaceId} 占位符。北京地域已实测 https://dashscope.aliyuncs.com/compatible-mode/v1 可用…
  TOPE Mate scoring server (ai, provider=bailian, transport=responses, timeout=120000ms) listening on http://127.0.0.1:3903
```

三条新保证都实测到位：

```
GET :3901/health → {"mode":"ai","provider":"bailian","transport":"responses","timeoutMs":20000,
                    "schemaVersion":"1.4.0","moduleVersion":"0.6.0","aiKeyConfigured":false,"model":"qwen3.8-flash"}
GET :3902/health → {"provider":"bailian","model":"qwen3-asr-flash","keyConfigured":false,"timeoutMs":5000,
                    "maxAudioBytes":7863552,"maxAudioSeconds":300,"allowedFormats":["webm","ogg","wav","mp3","flac"]}
POST :3901/api/evaluate（零 Key）  → HTTP 503 API_KEY_MISSING
node tools/asr-smoke.mjs --url http://127.0.0.1:3902
  [asr-smoke] 服务端配置：provider=bailian model=qwen3-asr-flash keyConfigured=false timeout=5000ms 上限=7863552B/300s
  [asr-smoke] HTTP 503，用时 0.01 秒；错误码：API_KEY_MISSING；exit=1（零供应商请求）
POST :3903/api/evaluate（伪造 Key + 占位符地址）→ HTTP 503 PROVIDER_CONFIG_ERROR，未发出任何外部请求
```

`/health` 现在直接打印 `transport` 与 `timeoutMs`，联网验收前就能看出「服务端到底在打哪条接口、超时够不够 59 秒」，不用猜。

---

## 6. 需要用户手动填写的配置项（本文件不含任何真实密钥）

评分服务 `modules/ai-scoring/.env`：

| 变量 | 填什么 | 留空会怎样 |
| --- | --- | --- |
| `SCORING_MODE` | `ai`（要真实模型评分才填） | 服务继续用离线启发式，不给练习分 |
| `SCORING_PROVIDER` | `bailian` | 默认 `openai` |
| `BAILIAN_API_KEY`（或 `DASHSCOPE_API_KEY`） | 控制台生成的 Key，**不要贴进对话** | `/api/evaluate` 返回 503 `API_KEY_MISSING` |
| `BAILIAN_BASE_URL` | **可留空**——默认就是成员 B 实测通过的 `https://dashscope.aliyuncs.com/compatible-mode/v1`，不需要 `{WorkspaceId}`；只有要用业务空间专属域名时才填真实 ID | 填了却仍含 `{WorkspaceId}` 或非 https → 503 `PROVIDER_CONFIG_ERROR`，且不出网 |
| `BAILIAN_MODEL` | 留空即 `qwen3.8-flash` | 用内置默认 |
| `BAILIAN_SCORING_TRANSPORT` | 一般不用填；需要回退 Chat Completions 时才填 `chat` | 默认 `responses`（实测通过的那条） |
| `BAILIAN_SCORING_REASONING_EFFORT` | 需要提速降费才填：`none`/`low`/`medium`/`high`/`xhigh`（该模型默认 `xhigh`，即约 59 秒） | 留空不发送该参数，保持与实测一致；**改档后必须重做一次真实验收** |
| `BAILIAN_ENABLE_THINKING` | 仅 `chat` 通路生效，需要思考过程才填 `true`（更慢更贵） | responses 通路不看这一项 |
| `SCORING_TIMEOUT_MS` | 需要放宽时填 | **默认 120000**（第五轮写的 45000 会必然超时）；填小于 60000 时启动会告警；前端总超时 150000 |

转写服务 `modules/speech-transcription/.env`：

| 变量 | 填什么 | 留空会怎样 |
| --- | --- | --- |
| `TRANSCRIBE_PROVIDER` | `bailian` | 默认 `openai` |
| `BAILIAN_API_KEY`（或 `DASHSCOPE_API_KEY`） | 同上 | `/api/transcribe` 返回 503 |
| `BAILIAN_BASE_URL` | **可留空**：默认与评分服务同一个已验证 dashscope 地址（ASR 仍拼 `/chat/completions`，与评分的 `/responses` 不是同一个接口）；两个服务可共用同一个百炼 Key，但模型权限要**分别**在业务空间开通 | 503 `PROVIDER_CONFIG_ERROR`，且不出网 |
| `BAILIAN_ASR_MODEL` | 留空即 `qwen3-asr-flash` | 用内置默认 |
| `BAILIAN_ASR_ENABLE_ITN` | 需要中文数字规范化才 `true` | 默认 `false` |
| `TRANSCRIBE_TIMEOUT_MS` / `MAX_AUDIO_BYTES` | 可选 | **默认 90000**（第五轮写的 60000 已在实测口径下偏低）/ 12 MB；bailian 通路自动收紧到 7,863,552 B；前端总超时 120000 |

安全边界（已实测核对）：Key 只出现在服务端 `.env`；`app.js`、`index.html`、`config/exam-config.js`、本文件与测试里都没有真实密钥；`.gitignore` 忽略 `.env`/`.env.*` 并只放行 `.env.example`；测试与日志都不打印密钥，服务端日志只记 `method/path/status/ms/bytes`，不含录音字节与转写文本；仓库内没有 `.env` 实体文件（本轮验证用的临时 `.env` 已删除）。

---

## 7. 测试命令与准确结果（本机 Windows 11，Node v26.13.1，全程离线）

```
cd modules/ai-scoring           && npm test  → 100 tests / 100 pass / 0 fail / 0 skipped
     （100 = 既有 58 + 第五轮 24 + 本轮 responses 专测 18；百炼相关文件合计 42 = chat provider 14 + chat HTTP 10 + responses 18）
cd modules/speech-transcription && npm test  →  61 tests /  61 pass / 0 fail / 0 skipped
     （61 = 既有 29 + 第五轮 29 + 本轮 provider 专测新增 3；百炼相关文件合计 32 = provider 19 + HTTP 13）
node tests/validate.cjs                       → PASS（C=196、B=22、categories=5、契约样例），失败 0
node tests/frontend-services.cjs              → PASS（转写 10 项 + 评分 7 组 + 流水线 10 组），失败 0
```

自动化合计：**161 个模块测试（100 + 61）+ 27 组前端服务层断言 + 1 套结构校验，全部通过，0 失败、0 跳过**。
既有 58 项评分测试与 29 项转写测试**未做任何放宽**，与新测试同时通过，说明 OpenAI 通路与旧行为未被破坏；
把默认接口从 `chat` 切到 `responses` 时曾让 9 项既有断言失败，处理方式是在两份 chat 专测里显式钉 `transport:'chat'`（而不是放宽断言），复跑全绿。

新增测试覆盖的任务书条目：北京 Base URL 配置与占位符拒绝、模型名配置与覆盖、百炼评分请求结构（`json_schema`/`strict`/无 `max_tokens`/提示词与 OpenAI 通路同源/`questionId` 不进模型）、百炼转写请求结构（`input_audio` + Data URI + `asr_options`）、WebM/Opus 处理与 m4a 拒绝、评分 JSON 解析与转写文本解析、鉴权失败（401/403）、模型不存在/地域不可用（404）、限流与 5xx、网络中断与超时、超长与超体积录音在出网前拒绝、不完整录音不进入正式评分、旧分阶段录音与旧 heuristic 模式不受影响、两把 Key 互不回退、响应与日志不泄露密钥/原文。

补丁新增的 21 项（评分 18 + 转写 3）覆盖：接口名解析与默认 `responses`、`bailianResponsesUrl` 对尾缀/占位符/非 https 的处理、**默认报文硬断言**（URL 以 `/responses` 结尾、`store===false`、`stream===false`、`instructions` 与 OpenAI 通路同源、嵌套 `text.format.json_schema` 的 `name/strict/schema`、`max_output_tokens===3600`，并断言 `max_tokens`/`response_format`/`messages`/`input_audio`/`tools`/`previous_response_id` 等字段一律不出现）、`input` 字符串与 OpenAI 通路逐字节相同、三通路报告 `deepEqual` parity、`output_text` 与 `output[]` 两种响应形态、`refusal`→`PROVIDER_REFUSAL`、`status:"incomplete"`→`PROVIDER_INCOMPLETE` 且练习分为 `null`、401/403/404/429/5xx 错误码映射且不回显 Key/host、超时与断网、无 Key/坏地址/坏接口名零次出网、`reasoning.effort` 默认不下发而配置后为 `{effort:'low'}`、HTTP 层 `transport`/`timeoutMs` 上报与 heuristic 不出网；转写侧补默认 dashscope 地址、留空即用、显式留空报 `PROVIDER_CONFIG_ERROR` 且零出网、请求体不含本地绝对路径。

**仍未执行**：真实百炼调用（第 9 节，评分侧的成本与耗时已由成员 B 的实测证实，本方不再重复付费调用；ASR 侧只跑了 `--dry-run` 与零 Key 的本地 503 分支）；GitHub Actions 云端跑一次（CI 里两个模块都是 `npm test`，会自动包含新文件，且已用 Node 22 镜像，本机尚未用 22 复跑）。

---

## 8. 已完成 / 未完成 / 待真实 API 验收

已完成
1. 北京地域两模型与接口的官方取证，并落成代码注释里的文档依据。
2. 评分服务百炼通路（Schema 1.4.0 与 B 的算法零改动迁移）。**补丁后默认接口 = 成员 B 实测通过的 `/responses`**。
3. 转写服务 `qwen3-asr-flash` 通路（Data URI、格式白名单、5 分钟/10 MB 上限、明确不截断），仍走 `chat/completions`，与评分接口不同属官方设计，未强行统一。
4. 两个服务的 provider 配置、错误码表、`/health` 如实上报（含 `transport`/`timeoutMs`/`maxAudioSeconds`）、启动前配置警告。
5. 配置模板、前端 provider 展示串与错误状态映射同步。
6. 53 个新增离线测试（评分 24 项 + 转写 29 项）+ 全部既有测试复跑 + 启动器实测。
7. **补丁追加**：评分侧 responses 传输层（18 项专测）、默认 Base URL 免 `{WorkspaceId}`、超时链路按实测重排（服务端 120000/90000 < 前端 150000/120000）、`store:false` 与思考档位可控、转写侧 3 项新断言、`tools/asr-smoke.mjs` 最小真实调用脚本（含 `--dry-run` 与零 Key 本地实测）。
8. **补丁追加**：零 Key 实机验证（临时端口 3901/3902/3903，用完即关）——503 `API_KEY_MISSING`、503 `PROVIDER_CONFIG_ERROR`、`/health` 字段、启动告警、smoke 脚本退出码全部实测通过，供应商侧请求发出 **0 次**。

未完成 / 明确不做（本轮范围外）
- 真实联网验收（评分侧由成员 B 代跑过，本方不重复付费调用；ASR 侧仍待批准）、真实额度与计费核对、业务空间 ASR 模型开通确认。
- Safari/m4a 支持（需要 DashScope 原生协议的新传输层）。
- Candidate A/B/C 选择、AI 虚拟讨论伙伴、动态考官、账号系统、公网部署——按任务书全部不动。
- 不安装任何新依赖：两个模块依旧零 npm 依赖，`qwen` 通路只用 Node 内置 `fetch`/`FormData`；`tools/asr-smoke.mjs` 同样零依赖。

待用户批准后的真实 API 验收（见下节步骤）
- 8 步顺序验证 + 第 9.5 节一次最小范围 ASR 冒烟；每一步失败即停，不重试烧额度。

---

## 9. 第一次真实转写与真实评分的人工步骤

**前置：以下第 0 步完成前，不要执行任何后续步骤，也不要让我执行——真实调用会付费，必须你明确批准。**

0. 控制台确认两件事（不花调用费）：这把 Key 的业务空间是否已开通 `qwen3-asr-flash`（**评分可用不等于转写可用**）；免费额度/账单状态正常。Key 只写进对应 `.env`，**不要贴进对话**；`{WorkspaceId}` 现在不需要填（默认地址已实测可用）。
1. 关掉旧的 `3001/3002` 窗口，双击 `启动 AI 后端.bat`；两个窗口的 listening 行应分别出现 `provider=bailian, transport=responses, timeout=120000ms` 与 `provider=bailian`。若出现 `EADDRINUSE`，按窗口里列出的 PID 处理，不要盲目 `taskkill`。
2. 浏览器开 `http://localhost:5173`，报告页的接入状态应显示两个服务在线且 `provider=bailian`。
3. 评分侧**不需要再花一次钱**：成员 B 已用团队 Key 在同地址、同 `/responses`、同模型上真实调用成功（HTTP 200 / 59.09 秒 / Schema 1.4.0 报告 / 证据校验通过）。你只需要确认 `curl -s http://127.0.0.1:3001/health` 返回 `aiKeyConfigured:true`、`transport:"responses"`、`timeoutMs:120000` 三项即可。若要验证本地这一份 responses 实现与 B 的报文一致，打一次即可、不要循环：
   用 `modules/ai-scoring/fixtures/c_high.json` 请求 `/api/evaluate`，检查 `data.mode==="ai"`、`practiceScore` 是 0–100 整数、`officialAssessment.level===null`、`scorePolicy.modelId` 是真实模型 ID。
4. 若第 3 步出现 `INVALID_MODEL_OUTPUT` 且提示 Schema 相关 → 把完整错误码与 message（**不要带 Key**）反馈给我，我再做最小修正，不要自行改 B 的算法。出现 `PROVIDER_TIMEOUT`（504）说明这台机器比 B 的实测更慢，先只调 `SCORING_TIMEOUT_MS`（前端已留 150000 余量），不要改算法。
5. 真人录音一段 **≤ 4 分钟** 的 C 侧 Speech（Chrome/Edge），在报告页确认「上传并生成 AI 分析」后才提交；期望：转写文本非空、`data.model==="qwen3-asr-flash"`、随后评分成功。
6. 检查防误标：报告页显示练习参考分与 1–6 级官方描述的区分文案，不出现「官方等级预测」；`demoOnly` 为 `false`；评分维度里发音/语调/音频流利度仍是「未评估」。
7. B 侧讨论（3 分钟）单独验一次：无真实说话人轮次时 `interaction` 必须是 `null` 并在页面显示未评估，而不是给分。
8. 故意造一次失败：断网或把 Key 改错一位 → 页面必须显示明确失败原因、可重试性提示，**绝不出现假分数或假转写**；然后再恢复。

每步都记录：HTTP 状态、`error.code`、`scorePolicy.modelId`、大致 tokens/费用。任何一步异常先停下来反馈，不要连续重试。

### 9.5 最小范围真实 ASR 调用（唯一还缺的验证，等你一句批准）

目的只有一个：回答「这把团队 Key 能不能调 `qwen3-asr-flash`」。用 `tools/asr-smoke.mjs`，它只发**一次**、只发**本机生成的 2 秒静音 wav**（64,044 B），不重试、不读任何 Key、不写文件。

```
1) node tools/asr-smoke.mjs --dry-run            ← 我已跑过：零网络、零费用，只打印报文形状（第 5.1 节）
2) 双击 启动 AI 后端.bat（.env 已配 BAILIAN_API_KEY/DASHSCOPE_API_KEY、TRANSCRIBE_PROVIDER=bailian）
3) node tools/asr-smoke.mjs                       ← 这一步才会真的花钱；需要你明确批准
```

预计成本 2 秒 × 0.00022 元/秒 ≈ **0.00044 元**（静音不产生可读文本，也就不会污染任何演示数据）。脚本会先读 `/health` 打印服务端生效的 provider/model/keyConfigured/timeout，再发请求，并按错误码给出定向下一步：

| 返回 | 含义 | 下一步 |
| --- | --- | --- |
| HTTP 200 + `transcript` 为空、`empty:true` | **权限已通**，静音本来就没词 | 可以进入第 9 节第 5 步的真人录音验收 |
| 503 `API_KEY_MISSING` | 服务端没读到 Key | 检查 `.env` 位置与变量名，重启服务 |
| 503 `PROVIDER_CONFIG_ERROR` | 自行填了非法 Base URL | 留空即用实测地址 |
| 502 `PROVIDER_MODEL_UNAVAILABLE` / 503 `PROVIDER_AUTH_ERROR` | **这把 Key 的业务空间没开通 ASR**（本次最可能得到的答案） | 控制台开通或与准备 Key 的成员核对，不要自行换地域或购买服务 |
| 502 `PROVIDER_HTTP_ERROR` | 供应商故障或额度/欠费 | 看控制台用量，最多手动重试一次 |

脚本失败即退出码 1，绝不自动重发；`--file/--seconds/--mime/--language/--stage` 可换成自己的录音，但演示前的第一次建议保持 2 秒静音。

---

## 10. 仍存风险与后续必要修复

1. **Safari 不可用**：`qwen3-asr-flash` 不收 m4a/mp4。演示必须用 Chrome/Edge；若要覆盖 Safari，需要为 `qwen-audio-3.1-asr-flash` 单独实现 DashScope 原生协议传输层（新工作项，需批准）。
2. **B 侧讨论 3 分钟贴着 5 分钟上限**：阶段延长或尾音会触发 413 `AUDIO_TOO_LONG`。当前行为是明确报错、不截断；若演示需要更长，必须走分段提交方案，而不是放宽上限。
3. **ASR 的真实权限仍未验证**：这是当前唯一没被任何实测覆盖的通路。已通过 `--dry-run` + 零 Key 本地 503 把「脚本与服务端」这一段验干净，剩下的「Key 是否开通 `qwen3-asr-flash`」必须靠第 9.5 节那一次真实调用或控制台确认，二者都不由我代做。
4. **`{type:"null"}` 已由 B 的 responses 实测间接证实可用**（同 Schema、同 `strict:true` 返回了通过证据校验的报告），但 chat 通路仍未真实验证；若某天真要切 `BAILIAN_SCORING_TRANSPORT=chat`，请把这当成待验证项。
5. **两份 responses 报文实现并存**：B 的 `provider.mjs`（打 OpenAI）与我的 `bailian-provider.mjs`（打百炼）形状相同、各写一份，漂移风险真实存在。合并 B 的代码后建议尽快抽公共构造函数，判定标准是三通路 `deepEqual` parity 测试（第 4 节）。
6. **59 秒实测贴着我设的 120 秒上限**：默认值按 B 的实测留了约一倍余量，但百炼排队或思考档位上调时仍可能 504。链路上「服务端 < 前端」的关系已写进注释与 `.env.example`，改任何一端都要同步另一端，否则浏览器只会留下静默 `timeout` 而拿不到后端错误码。
7. **思考档位默认跟随模型（`xhigh`）**：与 B 实测保持一致，代价是慢与贵。降档能明显提速降费，但会改变输出风格，必须重做一次真实验收，不能只看离线测试。
8. **免费额度与开通状态未核**：10 小时 ASR 额度、是否欠费（`Arrearage`）只能在控制台看，本轮零调用。
9. **旧进程仍在跑改动前代码**：`3001/3002` 需重启才启用百炼通路（第 5 节末尾有实测证据）；我不代关。
10. **Node 版本口径**：本机 v26.13.1、CI 用 Node 22，尚未在 22 上复跑四套测试。
11. **日志与密钥的既有保证依赖约定**：`env-lines.mjs` 会跳过非 ASCII 值并拒绝危险变量，但用户若手动 `set` 覆盖环境仍可能出格；后续如需更强约束，考虑给 `.env` 加一次显式校验命令。
12. **两轮都没有 commit/push/PR/合并**：基线 SHA 仍是 `08c04cd`，工作区混着第五轮改动、本轮补丁改动与成员 B 尚未同步的评分代码，不存在「包含这些改动的已提交且已复验的 SHA」。提交顺序建议：先由 B 同步他的评分代码 → 跑三通路 parity 测试 → 再一起 commit，避免我在合并冲突里覆盖 B 的实现。

---

## 11. 补丁记录：对齐成员 B 的真实实测结果（同日追加）

### 11.1 采信的事实与不采信的推断

成员 B 报回五条事实，全部按「外部报告」处理——我采信它们作为**配置方向的依据**，但没把它们当成本仓库的验收结论（本机没有复现任何一次真实调用）：

| B 的实测事实 | 本仓库据此做了什么 |
| --- | --- |
| 北京地域 + `qwen3.8-flash` + 团队 Key 已真实评分成功 | 评分百炼通路默认接口从 `chat` 切到 `responses` |
| 已验证 Base URL = `https://dashscope.aliyuncs.com/compatible-mode/v1`，**不需要 WorkspaceId** | 两个服务都把它设为内置默认；`.env` 里 `BAILIAN_BASE_URL` 从「必填」降为「可留空」 |
| `/responses`，HTTP 200，**59.09 秒**，Schema 1.4.0 报告、证据校验通过 | 服务端默认超时 45000→120000、前端 60000→150000；`/health` 上报 `transport`/`timeoutMs`；启动时告警「小于 60 秒会不稳定」 |
| `qwen3-asr-flash` 官方支持北京/英文/WebM，5 分钟与 10 MB 上限；**这把 Key 的 ASR 权限未验证** | ASR 通路不动接口形态，只补默认地址与新断言；另交付第 9.5 节的最小冒烟脚本，把「唯一待验证项」压缩成一次 2 秒静音调用 |
| 转写走 `/chat/completions`，与评分接口格式不同 | **不强行统一**：评分 responses、转写 chat，两套报文各自镜像官方文档，并在注释里写明差异 |

### 11.2 为什么这样切而不是「顺手统一」

用户明确要求「不要为了统一接口而破坏 B 已通过的评分实现」。落到代码上就是三条约束：
- `modules/ai-scoring/src/provider.mjs`（B 的 `scoreWithOpenAI`、`normalizeAIResult`、`getText`）与 `rubrics.mjs`、`practice-score.mjs`、`contract.mjs`、`ai-schema.mjs`、`scorer.mjs` **继续零改动**；百炼通路 `import` 它们，共用同一套 Schema 1.4.0 校验和分数计算。
- responses 报文只镜像 B 实测/OpenAI 通路已有的字段（`store:false`、`instructions`、`input` 字符串、嵌套 `text.format.json_schema`、`max_output_tokens:3600`），不发明新参数；`reasoning.effort` 只在用户显式配置时才下发，默认保持实测行为。
- `chat` 分支保留，两份 chat 专测显式钉 `transport:'chat'`（不改断言强度），这样两条通路都还在测试覆盖里，回退时不会裸奔。

### 11.3 超时链路重算

| 环节 | 补丁前 | 补丁后 | 依据 |
| --- | --- | --- | --- |
| 评分服务端 | 45000 ms | **120000 ms** | B 实测 59.09 s，45 s 必然 504 |
| 评分前端总超时 | 60000 ms | **150000 ms** | 必须 > 服务端，否则浏览器静默中断，只剩 `timeout` 拿不到后端错误码 |
| 转写服务端 | 60000 ms | **90000 ms** | ASR 单次可提交 5 分钟音频 |
| 转写前端总超时 | 75000 ms | **120000 ms** | 同上，保持「前端 > 服务端」 |
| 音频上传窗口 | 60000 ms | 60000 ms（不变） | 本地 5 分钟 WebM 远小于该窗口 |

### 11.4 交付状态

- 模块测试 100 + 61 全绿、根级 `validate.cjs` 与 `frontend-services.cjs` 全绿（第 7 节有逐项数字）。
- 零 Key 实机验证完成（第 5.1 节），临时端口 3901/3902/3903 用完已关闭；用户的 3001/3002/5173 未被触碰，仍是改动前的进程。
- 仍然没有：真实 ASR 调用（等批准）、commit/push/PR、公网部署、新依赖、`app.js`/`index.html` 改动。
- 需要用户做的只有三件：① 控制台看 ASR 开通状态；② 决定要不要批准第 9.5 节那一次 0.00044 元的冒烟调用；③ 让 B 先同步他的评分代码，再一起提交。
