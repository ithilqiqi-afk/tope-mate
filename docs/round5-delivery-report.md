# TOPE Mate 第五轮交付：真实语音转写、AI 评分与报告集成

- 交付日期：2026-11-21
- 执行人：A（前端与本机转写服务）、B（`modules/ai-scoring` 评分服务）
- 本轮性质：**本地安全联调**。真实付费 API 调用**未执行**（无 API Key），详见第 6、7 节。

## 0. 交付基线与 Git 状态

| 项目 | 实际值 |
| --- | --- |
| 工作目录 | 仓库根目录（GitHub 本地克隆，非桌面旧项目；克隆路径因人而异，本文档一律用相对路径表述） |
| 分支 | `feature/ai-integration` |
| 当前 HEAD | `08c04cd  Merge pull request #2 from ithilqiqi-afk/feature/ai-scoring`（与任务书基准一致，未移动） |
| 提交/推送/PR | **均未执行**；未切换分支、未合并、未触碰 `main` |
| 工作区状态 | 21 个已跟踪文件被修改、22 个新文件未跟踪（含整个 `modules/speech-transcription/`，以及本轮补的 `启动预览.bat` 端口检测） |
| 真实 `.env` | 仓库内不存在；`.gitignore` 已排除 `.env`、`.env.*`（保留 `.env.example`） |
| 音频文件 | `git status` 中无 `.webm/.wav/.m4a/.ogg`；本轮新增这四类忽略规则 |

> 本轮以 `08c04cd` 为唯一基线读取真实代码后再改动，没有依据任务描述推断结构；任务书要求的必读文件（`app.js`、`recorder.js`、`index.html`、`styles.css`、`config/exam-config.js`、`services/transcription.js`、`docs/contracts/`、`modules/ai-scoring/docs/*`、`modules/ai-scoring/src/http-server.mjs`、`modules/ai-scoring/examples/`、`.github/workflows/validate.yml`）全部实际打开核对过。

## 1. 本轮新增与修改的功能

### 1.1 语音转写链路（新建独立 Node 服务）

- 新模块 `modules/speech-transcription/`：契约 `transcribe_v1`，`POST /api/transcribe`（multipart：`audio` + `meta`）、`GET /health`；默认只监听 `127.0.0.1:3002`。
- 按 MIME 真实判型而非扩展名，支持 `webm/ogg/wav/mp3/m4a/flac`（`src/provider.mjs` 的 `SUPPORTED_AUDIO`）；不支持的格式在出网前返回 415。
- 体积双层上限：服务侧 `MAX_AUDIO_BYTES`（默认 12 MB，且不超过厂商 25 MB），前端 `services/transcription.js` 上传前本地预检，超限不产生任何网络请求。
- 错误码表把供应商故障翻译成可判定语义：`MALFORMED_MULTIPART`、`BODY_TIMEOUT`、`CORS_FORBIDDEN`、`PAYLOAD_TOO_LARGE`、`UNSUPPORTED_FORMAT`、`API_KEY_MISSING`、`PROVIDER_HTTP_ERROR`、`PROVIDER_NETWORK_ERROR`、`PROVIDER_BAD_RESPONSE`、`PROVIDER_TIMEOUT`，每项带 `status` 与 `retryable`。
- 无 Key 时服务照常启动并明确 503；静音返回空字符串；任何失败路径都不产生文本。日志只记方法、路径、状态码、字节数。
- 前端接入层保留并做实：`services/transcription.js` 只负责上传、解信封、绑定 `session/stage`；服务端回传的 `sessionId` 与本轮不符即判 `STALE_RESULT` 丢弃。

### 1.2 Schema 1.4.0 评分适配（废弃 v0.1 候选协议）

- `docs/contracts/` 的 request/response/error Schema、样例与 `tests/validate.cjs` 全部对齐 1.4.0；v0.1 的 `version`、`overallScore`、`dimensionScores`、`notAssessed` 字段在测试里被显式禁止回流。
- `services/evaluation.js` 重写：阶段映射（`intro→self_intro`、`presentation→statement`、`discussion→discussion`、`speech→speech`、`qa→qa`，`prepare` 不映射）、请求字段白名单、响应归一化与契约拒绝（版本不符、预测官方等级、练习分越界、缺 `data`）。
- 请求体永不含音频字段（`audio`/`audioBase64`/`recording`/`transcriptBase64` 由测试与运行时双重把关）。

### 1.3 报告页 AI 展示（新增编排层 + 渲染）

- 新脚本 `services/ai-pipeline.js`：转写 → 校对 → 评分的编排、会话/阶段绑定、`in-flight` 去重（重复点击复用同一 Promise，不重复计费）、离开报告页或开始新一轮时作废在途请求、`cancel` 语义、串行提交（`maxConcurrent = 1`）。
- `app.js` 报告页新增「真实语音转写与 AI 评分」卡片：服务状态、`检查服务状态`、`生成 AI 分析`（带确认框）、`停止在途请求`、按阶段独立状态（未开始分析/正在转写/转写成功/正在评分/分析完成/分析失败/未录音或证据不足）、每阶段独立的转写与评分入口、失败原因与可重试标记、`原始转写` 与 `你修改后的文本` 分离展示、评分所用文本与来源标注。
- 真实报告渲染覆盖 `practiceScore`、`scores`/维度表、`scoreStatus`、`scoreCoverage`、`dimensionFeedback`、`strengths`、`weaknesses`、`suggestions`、`evidence`、`peel`、`peelDetails`、`improvedExpressions`、`nextPractice`、`unassessed`、`errors`、免责声明。
- 防误标硬规则落地：单阶段分注明「不是整场考试总分」；`practiceScore` 为 `null` 显示「暂无法评分」而非 0 分；官方等级恒为「不预测」；`mode=heuristic` 显示离线提示且不给分；`meta.demoOnly=true` 即使 `data.mode=ai` 也挂「合成演示数据」横幅；所有外部文本经 `esc()` 输出。
- 示例报告与真实报告并存：页首大分数仍标为本地示例，两块互不覆盖。

### 1.4 录音完整性边界（任务书第 6 节）

- `complete:true` 的唯一依据是每段都收到过 `stop` 事件（`recorder.js` 的 `_groupsClosed`）；晚到的 `dataavailable` 只补数据、不改结论。
- `complete:false` 时：回放与下载照常保留、报告页标注「录音未确认完整」、评分默认被 `INCOMPLETE_RECORDING` 拦住、必须显式点「按现有内容评分」才提交，且报告持久记录 `recordingComplete:false`。
- 此前几轮验收通过的录音状态控制（异步授权不扣准备时间、暂停/跳过/提前结束的联动、单一录音器、`REC` 只在真正 recording 后出现）未被破坏，本轮实测复现。

### 1.5 Windows 启动与配置

- 新增 `启动 AI 后端.bat`：开两个独立窗口（评分 3001 / 转写 3002），各自读取同目录 `.env`。
- 新增 `停止 AI 后端.bat`：先用 `netstat` + `tasklist` 精确列出监听 3001/3002 且镜像名为 `node.exe` 的进程号，**要求输入 `Y` 才结束**；无命中时直接报告「已是停止状态」。
- 新增 `tools/serve-with-env.cmd` + `tools/env-lines.mjs`：`.env` 由 Node 解析（第一个 `=` 之后整体作值，含 `=` 的密钥不被截断），只注入当前进程环境，不写盘、不回显值。
- 新增两个模块的 `.env.example`，**全部为占位空值**；其中特别写明 `SCORING_MODE=ai` 才会调用模型，否则服务默认走离线启发式。
- 批处理约束（踩坑记录）：`.bat/.cmd` 内容必须 ASCII + CRLF。UTF-8 中文会让 `chcp 65001` 之后的 cmd 按字节偏移解析错位，表现为把一行拆成多条命令执行。中文说明一律放 README 与使用说明。
- **人工验收发现的启动故障已修复**（`start "标题" "helper.cmd" "参数"` 这种引号形态在 cmd 里根本不会执行目标脚本），根因、改法与复测见第 10 节。
- 两个模块**零 npm 依赖**，启动器现在直接 `node src\http-server.mjs`，不再经过 `npm run serve`，因此**不需要 `npm install`、不访问 npm 源**。

### 1.6 测试与 CI

- 新增 `tests/frontend-services.cjs`：纯离线（`vm` 沙箱 + 桩 `fetch`，无浏览器、无 Key、无付费调用）。
- `.github/workflows/validate.yml` 增加三步：`node tests/frontend-services.cjs`、`ai-scoring` 模块 `npm test`、新 `speech-transcription` job（Node 22，模块目录 `npm test`）。
- `tests/validate.cjs` 增补：脚本标签与加载顺序断言（服务层必须先于 `app.js`）、录音阶段与 `scoringStages` 映射的覆盖断言、`prepare` 不得映射、1.4.0 契约样例（含 B 自己发布的四份 HTTP 样例）结构校验。

## 2. A↔B 接口适配说明

- 前端只用两个 HTTP 入口：`POST http://127.0.0.1:3002/api/transcribe`（multipart）与 `POST http://127.0.0.1:3001/api/evaluate`（JSON，Schema 1.4.0 请求）；健康检查 `GET /health`。
- 信封解析严格按 `{success,data,meta}` / `{success:false,error:{code,message,retryable}}`；形状不符即判服务异常，不做任何猜测性兜底，也不采用任何文本。
- `meta.sessionId` / `meta.stage` 必须原样回传，前端据此丢弃过期响应。`meta.demoOnly`、`meta.questionId` 为强制字段。
- 阶段分数字段取 `data.practiceScore`（`overall.score` 必须与它完全相等）；维度分取 `data.scores`，维度说明与引用取 `data.dimensionFeedback`，权重取 `data.scorePolicy.configuredWeights`，覆盖度取 `data.scoreCoverage`。
- 前端在 `B/discussion` 且无真实轮次时**不发送** `assessedSpeaker` 与 `speakerTurns`，因此 `scores.interaction` 必须保持 `null`；本轮实测服务端确实返回 `null`，其 `unassessed` 里会出现 `group_interaction_without_speaker_turns` 这类非维度键，前端原样展示不解释为维度分。
- 待 B 复核（不是本轮阻塞项，但会影响展示一致性）：
  1. `modules/ai-scoring/examples/http-success-scored-demo.json` 内部自相矛盾——`scores` 有 6 个整数分，`scoreCoverage.notAssessedDimensions` 为空，但 `unassessed` 仍把这 6 个维度列为未评估。按 `src/contract.mjs:58` 的推导逻辑，这一组合不可能同时成立，疑为该样例是早版产物。前端已改为按打分表实际是否有分数推导「未评估项」，并在两者冲突时显式标注不一致而不是替服务端改数。
  2. `modules/ai-scoring/examples/` 的样例建议纳入 B 自己的测试生成链，避免 Schema 漂移时样例落后。
  3. 转写服务 `meta.demoOnly` 目前恒为 `false`（无合成演示模式）。若后续要提供无 Key 演示，请显式标记，前端已按 `true` 分支实现横幅。

## 3. 服务配置与启动

### 3.1 语音转写（`modules/speech-transcription`）

| 环境变量 | 作用 | 留空/默认行为 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 调厂商转写 | 未配置：`/api/transcribe` 返回 503 `API_KEY_MISSING`，不产生文本 |
| `PORT` | 监听端口 | 3002（必须与 `config/exam-config.js` 一致） |
| `TRANSCRIBE_MODEL` | 模型名 | 用 `src/provider.mjs` 的 `DEFAULT_MODEL` |
| `TRANSCRIBE_PROMPT` | 转写提示词 | 用服务内置默认 |
| `TRANSCRIBE_TIMEOUT_MS` | 单次调用超时 | 用服务内置默认；超时 → `PROVIDER_TIMEOUT`（504，可重试） |
| `MAX_AUDIO_BYTES` | 请求体上限 | 12 MB，且不超过厂商 25 MB 硬顶 |

启动：`cd modules/speech-transcription && npm install && npm run serve`（或双击 `启动 AI 后端.bat`）；`npm run health` 可查 `keyConfigured`。

### 3.2 AI 评分（`modules/ai-scoring`，B 维护）

`OPENAI_API_KEY`、`PORT`（默认 3001）、`OPENAI_MODEL`、`SCORING_MODE`（默认 `heuristic`，只有写 `ai` 才调用模型；写其他值服务直接退出）。

### 3.3 前端配置

`config/exam-config.js` 的 `services` 段集中写地址：`transcribeEndpoint`、`evaluateEndpoint`、`healthEndpoints`、`requestTimeoutMs.transcribe`（默认 75 s）、`maxAudioBytes`（12 MB）、`sendAudioToBackend`。地址留空时页面显示「尚未接入」，不会伪造结果。

### 3.4 网络与安全边界

- 两个服务只绑 `127.0.0.1`；CORS 白名单写死为 `http://localhost:5173` 与 `http://127.0.0.1:5173`，其他来源 403 `CORS_FORBIDDEN`。
- 本轮不做公网部署；`0.0.0.0` 绑定、反向代理、公网域名一律未配置。

## 4. 自动化测试执行结果（真实运行）

运行环境：Windows 11（10.0.26200）、本机 Node **v26.13.1**；GitHub Actions 用 Node **22**。全部离线，无 API Key、无付费调用、无浏览器。

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `node tests/validate.cjs` | `PASS: C=196, B=22, categories=5, phases and Schema 1.4.0 contract fixtures.` 失败 0（含第 10.3 节新增的 Windows 启动脚本断言） |
| 2 | `node tests/frontend-services.cjs` | `transcription.js 10 项`、`evaluation.js 7 组`、`ai-pipeline.js 10 组` 全通过，失败 0 |
| 3 | `cd modules/ai-scoring && npm test` | `tests 58 / pass 58 / fail 0 / skipped 0`（349 ms） |
| 4 | `cd modules/speech-transcription && npm test` | `tests 29 / pass 29 / fail 0 / skipped 0`（1375 ms） |

每条测试脚本结束时都会打印一行 `NOTE`，声明未覆盖的范围（真实网络、真实麦克风、题库来源真实性、真实 DOM 渲染）。**以上四项全部属于任务书第 10 节第 1 层（离线自动化测试）通过，不等于第 2 层（真实服务）通过。**

### 4.1 本机服务实时探针（3001/3002 在跑，无 Key、零付费）

交付复核时对本机真实服务重新发了一轮请求，结果如下（仍然只是「服务在线 + 诚实失败」，不是真实模型验证）：

| 探针 | 结果 |
| --- | --- |
| `GET 127.0.0.1:3001/health` | `mode=heuristic`、`schemaVersion=1.4.0`、`aiKeyConfigured=false` |
| `GET 127.0.0.1:3002/health` | `contract=transcribe_v1`、`keyConfigured=false`、`maxAudioBytes=12582912`、`allowedFormats=[webm,ogg,wav,mp3,m4a,flac]` |
| `POST 127.0.0.1:3001/api/evaluate`（契约样例） | `success=true`、`data.mode=heuristic`、`practiceScore=null`、`scoreStatus=not_scored`、`coveragePercent=0`、六个维度全进 `notAssessedDimensions`、`meta.demoOnly=false` |
| `POST 127.0.0.1:3002/api/transcribe`（上传 2086 字节的假 `audio/webm` + `meta` JSON） | `HTTP 503`、`API_KEY_MISSING`、「无法生成转写文本」，响应中没有任何文本字段 |
| `OPTIONS 127.0.0.1:3001/api/evaluate`，`Origin: https://evil.example.com` | `HTTP 403`（`CORS_FORBIDDEN`），只有 5173 白名单来源可通过 |
| 前端 multipart 字段核对 | `services/transcription.js:103-104` 发 `audio` + `meta`（JSON），与服务端解析逻辑一致 |

> 探针踩到的两个坑记录在这里以免重复误判：转写路由是 `/api/transcribe`（不是 `/transcribe`），业务字段必须打包成单个 `meta` JSON part，散着传 `stage=speech` 会得到 `422 INVALID_META`。**两条都是测试命令写错，不是代码缺陷**；前端一直按正确格式发送。


## 5. 人工验收清单

标注：**[本轮已实测]** = A 在本机真实浏览器（Chrome 内核，假麦克风 + 本机真实服务）走完并记录结果；**[待你复核]** = 需要真人语音/真实 Key/真实权限弹窗，本轮无法代替你完成。

### A. 转写服务

| 编号 | 操作 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| A1 | `npm run serve` 后 `GET http://127.0.0.1:3002/health` | `success:true`、`contract:"transcribe_v1"`、`keyConfigured:false` | [本轮已实测] |
| A2 | 无 Key 时 `POST /api/transcribe` | 503 + `API_KEY_MISSING` + `retryable:false`，响应体无任何文本 | [本轮已实测]（页面显示同一错误码） |
| A3 | 上传 0 字节音频 / `.txt` 改名 | 分别拒绝，不向厂商发起请求 | 模块测试覆盖（离线） |
| A4 | 上传超过 12 MB | 413 `PAYLOAD_TOO_LARGE`；前端在本地预检即提示，不发请求 | 服务与前端测试覆盖（离线） |
| A5 | 用真人录音走一次成功转写 | 报告页显示服务返回文本、模型名、格式、字节数 | [待你复核]（需真实 Key） |

### B. 录音与完整性

| 编号 | 操作 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| B1 | C 完整模拟（录音开启）到报告页 | 每阶段一条录音，`complete:true`，回放与下载可用 | [本轮已实测] |
| B2 | 真人权限弹窗慢慢点 | 准备倒计时不起表；批准瞬间才起表 | [待你复核]（本轮用桩权限，只验证了状态流转） |
| B3 | 制造「收尾 `stop` 事件未确认」的录音 | `complete:false` + `why:timeout`；数据保留可回放可下载；报告页标「录音未确认完整」 | [本轮已实测] |
| B4 | 在 B3 的阶段直接点「评分」 | 被 `INCOMPLETE_RECORDING` 拦住，不发出评分请求，不产生报告 | [本轮已实测] |
| B5 | 点「按现有内容评分」后再评分 | 允许提交，报告持续显示 `recordingComplete:false` 依据 | [本轮已实测] |

### C. 报告页真实 AI 分析

| 编号 | 操作 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| C1 | 进报告页看 AI 卡片 | 显示转写/评分两个服务地址与状态；未配置时「尚未接入」 | [本轮已实测] |
| C2 | 点「生成 AI 分析」 | 先出确认框：几段录音、约多少字节、传到哪两个地址、可能产生费用、一次一个请求、可中途停止；未点确认前零请求 | [本轮已实测] |
| C3 | 点「转写这段」（无 Key） | 「分析失败」+ 具体原因 + 错误码 + 「这一步没有产生任何分数」；评分按钮保持禁用；无伪造文本 | [本轮已实测] |
| C4 | 在文本框手打文本后点「评分」 | 请求 3001，返回 1.4.0 报告，标注「离线文本启发式（没有调用模型）」，分数位显示「暂无法评分」 | [本轮已实测] |
| C5 | 转写成功后修改文本再评分 | 页面区分「原始转写」与「已修改」，报告注明本次评分用的是修改后文本，原文仍可展开查看 | 编排层逻辑离线测试通过；[待你复核]（需真实 Key 才有原始转写） |
| C6 | 分析进行中点「停止在途请求」 | 在途阶段变「已作废」并保留已完成阶段的报告；该阶段可重试 | [本轮已实测] |
| C7 | 分析进行中离开报告页 / 开始新一轮 | 在途请求作废，过期响应不覆盖新一轮结果 | 离页与换轮触发已实测；跨会话覆盖判定由离线测试覆盖 |
| C8 | 连续快速点击同一阶段「转写这段」两次 | 只发一个请求（复用同一 in-flight Promise），`已请求次数`不翻倍 | 离线测试通过（断言两次拿到同一 Promise）；真人双击 [待你复核] |
| C9 | 外部返回文本里塞 `<img onerror>` 与 `<script>` | 只以转义文本显示，DOM 内无 `img/script` 节点、无脚本执行 | [本轮已实测] |

### D. 报告内容防误标

| 编号 | 检查点 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| D1 | 单阶段分数 | 紧邻标注「不是整场考试总分」 | [本轮已实测] |
| D2 | `practiceScore:null` | 显示「暂无法评分」，绝不显示 0 | [本轮已实测] |
| D3 | 官方等级 | 恒为「不预测」，`scaleMin/Max` 仅 1–6 描述锚点 | [本轮已实测] |
| D4 | 发音/语调/音频流利度 | 一律列入未评估，不给结论 | [本轮已实测] |
| D5 | B 讨论无真实轮次 | `interaction` 为 `null`，表格显示「未评估」 | [本轮已实测] |
| D6 | `mode:heuristic` | 离线横幅 + 全部维度未评估 + 无练习分 | [本轮已实测] |
| D7 | `meta.demoOnly:true` 且 `mode:ai` | 「合成演示数据」徽章 + 专项横幅（1.4.0 有分样例走真实渲染链） | [本轮已实测] |
| D8 | 评分失败 | 保持失败态，不回退成示例分数，页面两块数据来源标注互不混淆 | [本轮已实测] |

### E. B 考型

| 编号 | 检查点 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| E1 | B 完整模拟到报告页 | 出现 `intro/presentation/discussion` 三个阶段卡 | [本轮已实测] |
| E2 | 三阶段提交的 `stage` | 分别 `self_intro/statement/discussion`，`questionId` 带阶段后缀 | [本轮已实测] |
| E3 | `presentation` 的题目文本 | 主题 + 本次实际抽到的卡片角度（如 `… | Your angle (Card B): Natural disasters`） | [本轮已实测] |
| E4 | `prepare` 阶段 | 不出现在 AI 卡片里，不映射评分阶段 | 结构测试断言通过 |

### F. Windows 与配置

| 编号 | 操作 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| F1 | 双击 `启动 AI 后端.bat` | 两个窗口分别打印 listening；`.env` 存在时提示「已加载」但不显示 Key | **修复后已实测**：用 cmd 实际执行该脚本，`127.0.0.1:3001` 与 `127.0.0.1:3002` 均进入 LISTENING，两个 `/health` 正常返回且 `keyConfigured=false`（见第 10.4 节）；窗口里的中文/标题排版仍需 [待你复核] |
| F2 | 双击 `停止 AI 后端.bat` | 列出 3001/3002 的 `node.exe` 进程号，需输入 `Y`；输其他一律取消 | [本轮已实测]：识别到本轮真实 PID；`Y` 之后的 taskkill 分支用「预置 `ANS=Y` 的副本」验证成功结束两进程并释放端口。**真人键盘输入 `Y` 这一交互仍需 [待你复核]**——自动化通道里 `set /p` 读不到重定向输入（会读成一个反斜杠），无法代替你的手 |
| F3 | `.env` 写 `PORT=` 空值 | 回落到启动器默认端口；`KEY=a=b` 完整保留 | [本轮已实测]（修复后另加 `^`、`%`、危险变量三类用例，见第 10.4 节） |
| F4 | `git status` | 无 `.env`、无录音文件 | [本轮已实测] |
| F5 | 5173 被别的本地服务占用时双击 `启动预览.bat` | 不启动服务、不打开浏览器，列出占用端口的 PID 并提示先关掉那个窗口，按 `Y` 复查、其他键退出 | [本轮已实测]（用临时副本分别跑「占用」与「空闲」两条分支） |
| F6 | 5173 空闲时双击 `启动预览.bat` | 打开 `http://127.0.0.1:5173/`，页面与 `services/ai-pipeline.js` 等本轮新文件均可加载 | [本轮已实测]（临时副本改用 5199 端口验证服务分支：`/` 返回 200、字节数与仓库 `index.html` 一致、新文件 200）；真实 5173 双击 [待你复核]（需你先释放端口） |

## 6. 尚未完成、已知问题与安全风险

### 6.1 本轮明确没有实现（任务书第 11 节「暂不开发」仍然生效）

- 多人实时小组讨论与 AI 虚拟语伴（仍是单人自问自答）。
- 讨论中「候选 A/B/C 身份」选择、账号体系、成绩留存与排行榜。
- 大规模 UI 重构、移动端适配；公网部署（第 8 节：黑客松明确约束，属「按约定不做」，不是没做完）。
- 转写服务没有合成演示模式（`meta.demoOnly` 恒为 `false`），因此「无 Key 也能看到一段示范文本」这条路不存在——这是刻意设计，避免任何看起来像真实结果的假文本。

### 6.2 已知问题

1. **真实 API 链路未验证**：第 4 节四项全部是离线测试。转写与模型评分的真实联网行为、真实厂商错误码映射、真实音频格式兼容性均未经过实测（任务书第 10 节第 2 层）。
2. **录音可能长于计划阶段时长**：阶段切换与暂停兜底会把尾音一起录进来（实测出现过计划 3 s、录音 4–5 s 的情况）。多录的部分会一起转写。
3. **本地 Node 26 vs CI Node 22**：本轮所有本地结果在 Node v26.13.1 上取得，CI 用 Node 22；两个模块声明 `engines: node >= 18`。尚未在同一台机器上用 Node 22 复跑。
4. **端口 5173 冲突（已加防护；本轮末尾复测已恢复正常）**：人工验收期间实测过 `127.0.0.1:5173` 被桌面旧副本占着（那个预览进程的 `--directory` 指向桌面上的旧项目目录），而 `localhost:5173` 是本轮为不干扰你而起的 IPv6 临时服务（服务本仓库）——同一端口号两份不同代码，旧那侧对新文件返回 404。**本轮末尾复测**：旧副本已不在 5173，IPv4 与 IPv6 两个地址各有一个服务进程，两者返回的 `index.html`、`app.js`、`services/ai-pipeline.js` 与仓库文件**字节完全一致**（2332 / 110190 / 14611 字节），即当时打开哪个都是这一版代码。**具体 PID 属于运行时临时事实，由 `启动预览.bat` 或 `netstat -ano` 现场列出，不写进交付文档**。`启动预览.bat` 保留占用检测：一旦 5173 被别的目录占用就停下、列出 PID，不再静默打开旧版本（见 F5）；端口必须保持 5173，因为两个 AI 服务的 CORS 白名单只认它。演示前建议只用 `http://127.0.0.1:5173/`，并把 IPv6 那个临时服务窗口关掉以免混淆。
5. **示例数据与真实数据同页**：页首大分数永远是本地示例。虽有明确标注，仍存在被快速扫读时误读的可能。
6. **B 演示样例内部不一致**（见第 2 节待复核项 1），若 B 修正样例，前端的不一致提示会自动消失。
7. **Safari/Firefox 未验证**：`MediaRecorder` MIME 选择、`stop` 事件时序与暂停兜底只在 Chrome 内核上实测过。

### 6.3 安全与隐私

- 密钥只存在于服务端 `.env`；前端、仓库、控制台日志、文档中均无真实密钥。`tools/env-lines.mjs` 明确不回显值。
- 两个服务只绑 `127.0.0.1` 且 CORS 白名单写死，浏览器同源以外的页面拿不到接口。
- 录音只存浏览器内存，不写盘；默认不上传，任何上传都必须在报告页显式确认；评分请求只含文本，不含音频。
- 残留风险：`停止 AI 后端.bat` 会结束监听这两个端口的 Node 进程（已加确认门与镜像名校验）；若你在同机跑别的 Node 服务并占用 3001/3002，会被列出——请在确认前核对 PID。另外浏览器把转写文本渲染成可编辑文本框，若你把含个人信息的文本粘进去，评分服务会把它作为请求体发出去（仍是本机进程间通信，但日志之外不要粘贴身份证号等敏感内容）。

## 7. 下一步建议

1. 你提供 API Key 后，先在 `modules/speech-transcription` 用一条真实录音跑通 `A5`，再跑 `C5` 的原始/修改文本链路。
2. 决定题库来源核验的下一步：当前 196 + 22 的数量不代表出处已核验。
3. 与 B 对齐 `unassessed` 的语义边界（是否允许列已有分数的维度），并把 B 的 `examples/` 纳入生成链。
4. 在你本机用 Node 22 复跑四个测试，确认与 CI 一致后再合并 `feature/ai-integration`。
5. 合并前请先处理桌面旧项目的 5173 占用（`netstat -ano | findstr :5173` 现场查出 PID，再 `taskkill /F /PID <pid>`；本轮实测除桌面旧副本外还出现过第二个来源不明的占用进程），避免验收时看错版本。
6. 黑客松的「演示链接」形式确认之前，**不做任何部署**；确认之后若必须公网可访问，按第 9 表第 1 行的方案先征求你批准。

## 8. 本轮开发边界（黑客松约束，已实测核对）

本项目参加黑客松，目标是 **Windows 本地运行 + 完整功能演示 + 按时提交材料**。本轮以及后续未经你批准，一律不做以下事情：

| 约束 | 当前仓库实测状态 |
| --- | --- |
| 不部署 Vercel / Netlify / Render / Railway / 云服务器 / 任何公网平台 | 全仓（除 `node_modules`）没有 `vercel.json`、`netlify.toml`、`render.yaml`、`railway.json`、`railway.toml`、`wrangler.toml`、`firebase.json`、`serverless.yml`、`Dockerfile`、`docker-compose*` —— `find` 零命中 |
| CI 不做发布 | 只有 `.github/workflows/validate.yml` 一个 workflow；`grep -E "deploy|publish|vercel|netlify|npm publish|actions/deploy"` 结果为 `NO_DEPLOY_STEPS`，它只跑离线测试 |
| 不购买域名 / 云数据库 / 云主机，不做其他付费操作 | 未申请、未配置、未写入任何供应商地址；数据只在浏览器 `localStorage` 与本机内存 |
| 不擅自使用真实 API Key、不产生付费 AI 调用 | 两个服务实时 `/health` 均为 `keyConfigured=false` / `aiKeyConfigured=false`；全仓密钥扫描只命中测试用假串 `sk-test-key-do-not-log`；`.env` 被 `.gitignore:69` 排除且本机不存在 |
| 保留 Node.js 本地服务与 Windows 一键启动 | `启动 AI 后端.bat` / `停止 AI 后端.bat` / `tools/serve-with-env.cmd` 保持不变（ASCII + CRLF）；`启动预览.bat` 只做本地预览，且新增了 5173 占用检测 |
| 服务不暴露到公网 | 实测 `netstat`：3001 / 3002 全部只监听 `127.0.0.1`；CORS 白名单只认 5173 本机来源，外来 Origin 返回 403 |
| 不自动 Commit / Push / PR / 改 main | 分支 `feature/ai-integration`，HEAD 仍是 `08c04cd`，全部改动留在工作区（21 个已跟踪文件修改 + 22 个新文件未跟踪）；`origin` 指向 `ithilqiqi-afk/tope-mate` 但本轮没有网络写操作 |
| 不加非必要功能 | 本轮唯一的代码改动是 `启动预览.bat` 的端口占用检测（否则评委会打开旧副本，属于「用户能在本机完成核心操作」的硬性障碍）；没有新增功能面 |

## 9. 需要你批准才能进行的外部服务操作（本轮一项都没执行）

下面每一项都会触达本机之外，或产生费用，或改动共享仓库。**在你明确批准之前我不会执行任何一项**，并且都给了本地最小替代方案：

| # | 外部操作 | 触发场景 | 代价 / 风险 | 最小替代方案（当前采用） |
| --- | --- | --- | --- | --- |
| 1 | 把前端部署到公网（Vercel / Netlify / GitHub Pages / Cloudflare Pages / 对象存储静态站点） | 比赛要求「演示链接」 | 页面能打开，但 `127.0.0.1:3001/3002` 在公网不可达，**AI 转写与评分整条链路会失效**；若为此把两个 Node 服务也部署上去，就等于把未鉴权的付费接口暴露公网（禁止） | 演示录屏 + 提交仓库地址 + 把本目录打包给评委本地双击 `启动预览.bat`；链接形式等你确认比赛规则后再定 |
| 2 | 真实转写 / 真实模型评分的联网调用 | 想拿到真实分数与真实转写文本 | 产生厂商计费；需要你把 Key 交出来；真实厂商错误码需重新验证 | 继续跑「服务在线但明确报 `API_KEY_MISSING` / `heuristic`」的诚实路径，报告不伪造分数 |
| 3 | 云数据库、账号体系、用户身份存储 | 想保存历次成绩 | 引入个人数据与合规面，且与「不添加非必要功能」冲突 | 成绩只留 `localStorage`，导出靠下载录音/复制报告文本 |
| 4 | `git push` / 创建 PR / 合并 `main` / 授予仓库权限 | 材料提交进 GitHub | 改写共享仓库；此前连接账号 `zsh0424` 访问目标仓库返回 404 | 改动全部留在工作区，由你 review 后自己提交，或明确授权我按你给的 commit message 提交 |
| 5 | 引入任何 CDN、第三方脚本、字体、统计或分析服务 | 想让页面「更好看」或看访问数据 | 破坏零依赖与离线可运行，且把评委的访问暴露给第三方 | 保持现在的全本地静态资源，无任何外部请求 |
| 6 | 结束你机器上已有的进程（占用 5173 的桌面旧副本 `python -m http.server 5173`、第二个来源不明的占用进程，以及 IPv6 那个临时服务） | 想让 `http://127.0.0.1:5173/` 打开这一份代码 | 不是外部服务，但会关掉你另开的窗口，属可感知改动 | 我只给命令形态 `taskkill /F /PID <pid>`（PID 由 `netstat -ano` 现场查出），由你手动执行；`启动预览.bat` 会先替你检测并把 PID 列出来 |
| 7 | 把 `.env` 里的真实 Key 带进任何提交、日志、截图或路演材料 | 排障时最容易顺手做 | 密钥泄露且会被 Git 历史永久保留 | 密钥只写服务端 `.env`（已被忽略）；启动器与测试脚本都只回显「已配置 / 未配置」，绝不回显值 |

## 10. 人工验收发现的 Windows 启动故障：根因与修复

### 10.1 现象（你报告的原话）

双击 `启动 AI 后端.bat` 后，3001 与 3002 两个窗口都只显示「文件名、目录名或卷标语法不正确。」，随后回到仓库根目录的 CMD 提示符，没有任何 listening 行。

### 10.2 定位过程

先把 `tools/serve-with-env.cmd` 单独在当前窗口跑（`@echo on` 跟踪）：node 在 PATH 时**一路执行到 `npm run serve`，没有任何报错**——问题不在脚本内部。再用自记日志的探针脚本，把 `start` 的四种写法各跑一次，看新窗口到底有没有执行目标：

| 变体 | `start` 写法 | 目标脚本是否执行 | 参数解析 |
| --- | --- | --- | --- |
| V1 | `start "T" "helper.cmd"`（无后续参数） | **执行** | — |
| V2 | `start "T" cmd /c call "helper.cmd" "dir" "Scoring" 3001` | **执行** | 三个参数全部正确 |
| V3 | `start "T" "wrapper.cmd"`（wrapper 内部再 call） | **执行** | 正确，但路径里留 `tools\..\modules` |
| **V4** | `start "T" "helper.cmd" "dir" "Scoring" 3001` ← **本轮上线时用的就是这个** | **完全没执行**（日志里连一段都没有） | — |

结论：`start` 会把「带引号的 .cmd 路径 + 后续带引号参数」原样塞进新窗口的 `cmd /c "…"` 里。cmd 对 `/c` 的解析规则是：字符串以引号开头且引号不止一对时，**把整串当成一个可执行文件名**，于是报「文件名、目录名或卷标语法不正确」并回到提示符。V1/V2/V3 之所以正常，是因为 `/c` 后面的引号恰好只有一对（或首字符不是引号），cmd 会剥掉外层引号再执行。

另外验证了路径含空格的场景：在一个名字带空格的临时目录（`tope mate space test`，与仓库同级）下，V2 依然正确解析三个参数 ✓。

### 10.3 修改内容

| 文件 | 改动 |
| --- | --- |
| `启动 AI 后端.bat` | 两行 `start` 改成 V2 形态（`start "标题" cmd /c call "helper" "目录" "标签" 端口`），并写明这条 cmd 引号规则；顺带说明不需要 `npm install` |
| `tools/serve-with-env.cmd` | 重写失败处理：模块目录缺失 / node 不在 PATH / 缺 `src\http-server.mjs` / 端口参数没传，四条分支各自打印原因、`pause` 保留窗口、返回非 0；启动前回显 目录、node 版本、端口、Key 状态；端口已被占用时列出占用 PID 并提示先停旧的；启动命令改为直接 `node src\http-server.mjs`（等价于 `npm run serve`，但零依赖、不碰 npm 源）；结束后报退出码与常见原因 |
| `tools/env-lines.mjs` | `.env` 不再经 `for /f` + `call` 注入（那条路会把值里的 `^` 吃掉），改为生成 `%TEMP%` 下的临时批处理、`call` 完立即删除；值里的 `%` 按批处理规则加倍以还原原值；`PATH` / `PATHEXT` / `TEMP` / `TMP` / `WINDIR` / `SystemRoot` / `ComSpec` / `PROMPT` / `NODE_OPTIONS` / `NODE_PATH` / `NODE_EXEC_PATH` 一律拒绝覆盖（只打印变量名，绝不打印值）；含非 ASCII 的行跳过并报告条数 |
| `tests/validate.cjs` | 新增 Windows 启动脚本回归断言：四个 `.bat/.cmd` 必须 ASCII + CRLF；`start` 行必须带 `cmd /c call` 层、禁止 `start "标题" "x.cmd" "参数"` 形态；必须分别指向 3001/3002；helper 必须有五条失败分支与明确报因；必须走临时批处理加载 `.env` 并删除它；loader 必须有危险变量黑名单与 `%` 还原；`启动预览.bat` 必须先检测 5173 占用 |

评分与转写的功能代码（`src/*.mjs`、`services/*.js`、`app.js`）**一行没动**，只修本地启动链。

### 10.4 复测结果（本机 Windows 11，Node v26.13.1，无 API Key）

| 复测项 | 结果 |
| --- | --- |
| 实际执行 `启动 AI 后端.bat`（等价于双击） | 两个服务起来：`127.0.0.1:3001` 与 `127.0.0.1:3002` 均 LISTENING；`/health` 分别返回 `mode=heuristic / schemaVersion=1.4.0 / aiKeyConfigured=false` 与 `contract=transcribe_v1 / keyConfigured=false`；**没有再出现「文件名、目录名或卷标语法不正确」** |
| 启动后的行为仍是诚实路径 | `POST /api/evaluate` → `success=true, mode=heuristic, practiceScore=null, scoreStatus=not_scored, demoOnly=false`；`POST /api/transcribe`（上传假 webm）→ `HTTP 503 API_KEY_MISSING`，无伪造文本；外来 Origin → 403 |
| `.env` 值保真（临时目录里的隔离副本，不碰真实仓库） | `OPENAI_API_KEY=sk-Test^Key=with=equals` 原样进入环境（长度 23，`^` 与两个 `=` 都在）；`ODD=100%sales` 还原为 `100%sales`；`PORT=` 空值回落到启动器默认 3001；`SCORING_MODE=ai` 生效；`PATH` / `NODE_OPTIONS` 被拒载并只打印变量名；临时批处理执行后不存在 |
| 失败分支 | 目录不存在 → `module folder not found` + 原因，退出码 1；PATH 里没有 node → `node.exe was not found on PATH`，退出码 1；空模块目录 → `src\http-server.mjs is missing`，退出码 1；漏传端口 → 打印正确用法，退出码 1。（四条都在脚本副本上实测，真实文件里 `pause` 会把窗口留在屏幕上） |
| 端口占用提示 | 临时副本对着正在被占用的 3001 启动时，先列出占用 PID 再提示「若随后报 EADDRINUSE，请先停掉旧的」 |
| `停止 AI 后端.bat` | 识别到新一轮的真实 PID 并列出；用「预置 `ANS=Y`」的副本验证 taskkill 分支确实把 3001/3002 两个进程结束、端口释放，然后再用修好的启动脚本重新拉起。最后一次复跑：`127.0.0.1:3001` 与 `127.0.0.1:3002` 均 LISTENING，窗口里分别出现 `listening on http://127.0.0.1:3001` 与 `listening on http://127.0.0.1:3002`，`/health` 正常。**端口与 PID 都是运行时的临时事实**（关掉那两个窗口就没了，PID 每次启动都不同），不作为交付内容；演示前双击 `启动 AI 后端.bat` 即可 |
| 自动化测试 | `node --check app.js` / `node --check tools/env-lines.mjs` 通过；`node tests/validate.cjs` → PASS（含新增启动脚本断言）失败 0；`node tests/frontend-services.cjs` → 10 + 7 + 10 组全通过；`modules/ai-scoring` 58/58；`modules/speech-transcription` 29/29 |
| 回归网的反向验证 | 把 `start` 行退回旧写法（保持 CRLF）后 `node tests/validate.cjs` **如期失败**并指出该行缺 `cmd /c call` 层；把 `sed -i` 造成的 LF 结尾也被同一条 CRLF 断言拦下；之后文件按字节还原（`cmp` 一致）并重新 PASS |
| 页面侧核心操作仍可达 | 复测时 `127.0.0.1:5173` 与 `localhost:5173` 返回的 `index.html`(2332B)、`app.js`(110190B)、`services/ai-pipeline.js`(14611B) 与仓库文件**字节完全一致**，配合上面两个健康服务，本机「录音 → 转写 → 评分 → 报告」链路的前提成立 |
| 边界复查（修复后） | 仓库内仍无任何部署清单；CI 仍无 deploy/publish 步骤；`git status` 无 `.env`、无录音文件；HEAD 仍 `08c04cd`，分支 `feature/ai-integration`，21 个已跟踪文件修改 + 22 个新文件未跟踪，未 commit / 未 push / 未开 PR |

### 10.5 这一项仍然只能由你本人确认

- 真人双击后在窗口里**亲手输入 `Y`** 让 `停止 AI 后端.bat` 结束服务：我这边的自动化通道里 `set /p` 读不到重定向输入（会读到一个反斜杠），所以「输入 Y」这条交互路径只能由你在真键盘上验证；我已用预置 `ANS=Y` 的副本证明 `Y` 之后的执行分支本身是对的。
- 窗口标题、屏幕位置、以及两个窗口各自 300 行内没有中文乱码：需要真机肉眼确认。
