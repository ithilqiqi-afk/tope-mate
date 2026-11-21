# TOPE Mate 共享状态

更新日期：2026-11-21（百炼兼容补丁对齐成员 B 的真实实测结果后）；状态：**本地联调通过；评分百炼通路已切到 B 实测通过的 `/responses` 并按 59 秒实测重排超时；ASR 权限仍未做任何真实验证；本轮未提交、未推送**。
完整交付说明见 [`round5-bailian-patch-report.md`](round5-bailian-patch-report.md)（第 1–10 节为第五轮补丁、**第 11 节为本次补丁记录**）与 [`round5-delivery-report.md`](round5-delivery-report.md)（第五轮主体）。

上一版状态原文（保留，不再代表当前状态）：「状态：**待同步 GitHub**（本文件来自 A 上传的本地原型，尚未合并仓库既有文件）。」

## 当前稳定基线
- A 的 Qoder 原生 HTML/CSS/JS 第一阶段原型；成员 A 本地人工验收 6/6 项通过。
- GitHub 仓库目标：`ithilqiqi-afk/tope-mate`；本次连接账号 `zsh0424` 访问返回 404，未读取或提交到远程。
- 最近通过测试的远程 commit ID：**待首次提交及远程复验后填写**；不可填本地模拟 ID。
- 第五轮基线：工作目录为**仓库根目录**（GitHub 本地克隆，路径因人而异，本文档一律用相对路径表述），分支 `feature/ai-integration`，HEAD 仍是任务书基准 `08c04cd  Merge pull request #2 from ithilqiqi-afk/feature/ai-scoring`。改动全部留在工作区（本次补丁收尾实测：**22 个已跟踪文件修改 + 16 个未跟踪条目**，未跟踪条目展开后是 31 个文件，合计 53 个改动；新增的是 `modules/ai-scoring` 的百炼 provider 与三份百炼测试（含 `bailian-responses.test.mjs`）、整个 `modules/speech-transcription/`、`services/ai-pipeline.js`、`tools/`、两份交付报告等），**没有 commit、push、PR，也没有触碰 `main`**。
- 「最新通过测试 commit SHA」现状：自动化测试通过的是 `08c04cd + 未提交工作区`；尚不存在「包含本轮改动的已提交且已复验的 SHA」，不得填基线 SHA 冒充。

## A 已有
- B/C 选择、分类抽题、倒计时、阶段推进、暂停/恢复与提醒、B 三卡、示例报告。
- C 196 道、B 22 组现有本地题目；数量不代表来源核验。
- 第二至第四轮：分阶段麦克风录音、报告页回放与下载、异步授权与阶段切换竞争修复、考前设备检查、录音完整性如实标注。
- **第五轮新增**：本机语音转写服务 `modules/speech-transcription`（契约 `transcribe_v1`，默认 `127.0.0.1:3002`）、前端接入层做实（`services/transcription.js`）、Schema 1.4.0 评分适配（`services/evaluation.js` 重写，v0.1 候选字段被测试禁止回流）、编排层 `services/ai-pipeline.js`（防重复计费、过期响应作废、停止在途）、报告页「真实语音转写与 AI 评分」卡片与 1.4.0 真实报告渲染（含所有防误标硬规则）、录音 `complete:false` 默认不提交评分、Windows 一键起停（`启动 AI 后端.bat` / `停止 AI 后端.bat` + `tools/`）、两个模块的 `.env.example`、离线前端服务层测试与 CI 扩充、README/使用说明改写。

- **第五轮人工验收后修复**：双击 `启动 AI 后端.bat` 报「文件名、目录名或卷标语法不正确」的根因是 `start "标题" "helper.cmd" "参数"` 这种引号形态在 cmd 里根本不会执行目标脚本（对照实验见交付报告第 10.2 节）；已改为 `start "标题" cmd /c call …`，并把批处理格式与 `start` 形态写进 `tests/validate.cjs` 的回归断言。顺带：`tools/serve-with-env.cmd` 五条失败分支全部明确报因并保留窗口、启动前回显目录/node 版本/端口/Key 状态与占用端口的 PID；`.env` 改走临时批处理加载（`^`、`%`、`=` 不再被吃掉，`PATH`/`NODE_OPTIONS` 等危险变量拒绝加载，临时文件读完即删）；两个模块零依赖，启动改为直接 `node src\http-server.mjs`，**不再需要 `npm install`**；评分与转写功能代码零改动。详见 `docs/round5-delivery-report.md` 第 10 节。

- **第五轮百炼兼容补丁**：两个服务新增可选的阿里云百炼（华北2·北京）通路，用 `SCORING_PROVIDER` / `TRANSCRIBE_PROVIDER` 切换，默认仍是 `openai`。转写走 `chat/completions` + `input_audio` + Base64 Data URI（百炼没有 `/audio/transcriptions`，也明确不接受本地文件路径），格式白名单 `webm/ogg/wav/mp3/flac`、**不含 m4a/mp4**，`>300 秒` 返回 413 `AUDIO_TOO_LONG`、编码后 `>10 MB` 返回 413，两者都在出网前拒绝且**绝不截断**。`BAILIAN_API_KEY`/`DASHSCOPE_API_KEY` 与 `OPENAI_API_KEY` 互不回退。详见 `docs/round5-bailian-patch-report.md`。

- **百炼补丁·同日追加（对齐成员 B 的真实实测）**：
  1. **评分默认接口改为 `/responses`**（`BAILIAN_SCORING_TRANSPORT` 默认 `responses`，`chat` 保留为可切换备用通路）。报文逐字段镜像 B 实测通过 / 仓库 OpenAI 通路已有的形态：`store:false`、`instructions`、`input` 字符串、嵌套 `text.format.json_schema{strict:true}`、`max_output_tokens:3600`；`reasoning.effort` 仅在显式配置时下发（`qwen3.8-flash` 默认 `xhigh`，正是 59 秒耗时的来源）。
  2. **`BAILIAN_BASE_URL` 不再需要 `{WorkspaceId}`**：默认内置 `https://dashscope.aliyuncs.com/compatible-mode/v1`（B 实测通过的地址），用户留空即可；转写同 host，只是拼成 `/chat/completions`。评分与转写**没有强行统一接口**——两条通路分别对应官方两套 OpenAI 兼容端点。
  3. **超时链路按实测重排**：评分服务端 45000→120000 ms、前端 60000→150000 ms；转写服务端 60000→90000 ms、前端 75000→120000 ms；保持「服务端 < 前端」，否则浏览器只留下静默 `timeout` 而拿不到后端错误码。`/health` 现上报 `transport` 与 `timeoutMs`，启动时若 `SCORING_TIMEOUT_MS<60000` 会告警。
  4. **`tools/asr-smoke.mjs`（新增，零依赖）**：为「这把 Key 到底能不能调 `qwen3-asr-flash`」准备的最小真实调用脚本，只发一次 2 秒本机生成静音 wav（≈0.00044 元）、不读 Key、不重试、`--dry-run` 完全离线。**本方未执行真实调用，等用户批准**。
  5. 成员 B 的 `provider.mjs`/`rubrics.mjs`/`practice-score.mjs`/`contract.mjs`/`ai-schema.mjs`/`scorer.mjs` 继续零改动；`chat` 专测显式钉 `transport:'chat'` 而非放宽断言，并新增三通路 `deepEqual` parity 测试作为「只换传输层」的判定标准。

## B 已报告（未收到文件验证）- C 139 道候选、B 28 组候选；JSON + Excel、初版来源整理、评分协议与模拟评分原型。
- 第五轮更新：B 的 `modules/ai-scoring` 已作为真实代码进入本仓库并完成字段级对接（阶段映射、请求白名单、1.4.0 信封、`examples/` 四份 HTTP 样例已纳入 `tests/validate.cjs` 校验）。题库候选（139/28）仍未收到文件，来源核验仍未完成。
- **2026-11-21 B 报回的真实调用结果（外部报告，本方未复现）**：阿里云百炼华北2·北京 + 团队 Key + `qwen3.8-flash`，Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`（不需要 WorkspaceId），走 `/responses`，HTTP 200、耗时 **59.09 秒**，返回 Schema 1.4.0 报告且原文证据校验通过；B 侧本地 73/73 测试通过。本仓库据此把评分默认接口与超时对齐实测口径（见上一节），但**没有重复付费调用**，也未把这条外部结果写成本方验收结论。B 尚未确认该 Key 是否开通 `qwen3-asr-flash`（评分可用 ≠ 转写可用）。

## 进行中/待办
- A：获取仓库访问权限；迁移并远程运行复验；之后录音与按阶段采集。
- B：提供实际 JSON/评分输出样例；来源审核；转写方案。
- 共同：评分协议已冻结为 Schema 1.4.0（`docs/contracts/README.md` 记录了 v0.1 候选的废弃映射表）；转写接口见 `modules/speech-transcription/docs/transcribe_api.md`。
- 第五轮后待办（按优先级，2026-11-21 补丁后重排）：
  1. **`qwen3-asr-flash` 的第一次真实 ASR 调用**：`node tools/asr-smoke.mjs --dry-run` 已验（零网络），真实那一次约 0.00044 元、2 秒静音，**等用户明确批准**才执行；若返回 `PROVIDER_MODEL_UNAVAILABLE`/`PROVIDER_AUTH_ERROR`，说明这把 Key 的业务空间没开通 ASR，需要控制台处理，不要换地域。步骤与错误码对照见 `docs/round5-bailian-patch-report.md` 第 9.5 节。
  2. **无 Key 离线测试已完成**（100 + 61 模块测试、27 组前端断言、结构校验、3901/3902/3903 零 Key 实机）；真人浏览器验收仍待：Chrome/Edge 录音 → 转写 → 评分 → 报告全流程，`{WorkspaceId}` 现在不需要填。
  3. **不要重复真实付费评分调用**：B 已验过一次；本地 `3001` 若仍是旧进程需先重启才能拿到 `transport:"responses"`。合并顺序建议：B 先同步他的评分代码 → 跑三通路 parity 测试 → 再一起 commit（避免我在冲突里覆盖 B 的实现）。
  4. 与 B 对齐 `unassessed` 语义：`modules/ai-scoring/examples/http-success-scored-demo.json` 把已有分数的维度也列为未评估，前端已改为按打分表推导并在冲突时显式提示。
  5. 题库来源核验（196 + 22 的数量不等于出处已核实）。
  6. 在本机用与 CI 相同的 Node 22 复跑四套测试后再考虑合并。
  7. 黑客松「演示链接」形式确认后再决定是否部署；确认前保持零部署，任何公网托管或付费调用都要先取得用户批准（见 `round5-delivery-report.md` 第 9 节）。
  8. 真人双击两个启动器各看一次屏幕：`启动 AI 后端.bat` 的两个窗口是否出现 listening 行、`停止 AI 后端.bat` 里手敲 `Y` 是否真的结束服务（自动化通道无法代替键盘输入，见第 10.5 节）。

## 测试方法与结果
- 自动化测试（本机 Windows 11 / Node **v26.13.1**，全程离线、无真实 API Key、无浏览器、无付费调用；数字为**本次 Responses 对齐补丁后**复跑结果，`npm test` 与 `node --test` 口径一致）：
  - `node tests/validate.cjs` → PASS（C=196、B=22、categories=5、阶段配置与 Schema 1.4.0 契约样例），失败 0。
  - `node tests/frontend-services.cjs` → 转写 10 项、评分 7 组、流水线 10 组全通过，失败 0。
  - `cd modules/ai-scoring && npm test` → **100 tests / 100 pass / 0 fail / 0 skipped**（既有 58 + 第五轮 24 + 本轮 responses 专测 18）。
  - `cd modules/speech-transcription && npm test` → **61 tests / 61 pass / 0 fail / 0 skipped**（既有 29 + 第五轮 29 + 本轮默认 Base URL 专测 3）。
  - 启动实测（本轮改用环境变量直接起模块入口，端口 `3901/3902/3903`，不占用也不触碰用户的 `3001/3002/5173`，验完逐个关闭、端口已释放）：
    - listening 行如实打印 transport 与生效超时：`SCORING_TIMEOUT_MS=20000` 时是 `provider=bailian, transport=responses, timeout=20000ms` 并伴随「小于实测约 59 秒」告警；不设该变量时是 `timeout=120000ms`（3903 实测）。
    - `/health` 上报 `transport`、`timeoutMs`、`maxAudioBytes:7863552`、`maxAudioSeconds:300` 与 5 项格式白名单；`aiKeyConfigured/keyConfigured` 均为 `false`。
    - 零 Key：`/api/evaluate`、`/api/transcribe` 均 503 `API_KEY_MISSING`（转写消息点名 `BAILIAN_API_KEY`/`DASHSCOPE_API_KEY`）；伪造 Key + `{WorkspaceId}` 占位符地址：503 `PROVIDER_CONFIG_ERROR`；**供应商侧外部请求 0 次**。
    - `node tools/asr-smoke.mjs --dry-run` 退出码 0、零网络；`--url http://127.0.0.1:3902`（零 Key）退出码 1、503 `API_KEY_MISSING`，并先打印服务端生效配置。
    - 仓库内没有 `.env` 实体文件（本轮通过环境变量注入，用完即失效）；全仓 `sk-` 形态密钥串 0 处；无 vercel/netlify/render/railway/Docker 配置；CI 仅 `validate.yml` 且无 deploy/publish 步骤。
- 第五轮人工验收：真实浏览器（假麦克风 + 本机 3001/3002 真实服务）走完缺 Key 诚实失败、手打文本→离线启发式、`complete:false` 拦截与显式允许、停止在途请求、HTML/脚本注入转义、B 三阶段请求字段与 `interaction:null`、确认框文案。**真实 API 调用与真人权限弹窗未由本方验证**，逐项清单与状态标注见 `docs/round5-delivery-report.md` 第 5 节。
- 分层结论：以上只证明**第 1 层（离线）与本地联调通过**。评分百炼通路的报文形状已对齐**成员 B 的一次真实调用结果**（该真实验证由 B 完成，本方未复现，不能写作本方通过）；**ASR 通路至今零真实调用**，`qwen3-asr-flash` 的 Key 权限是唯一还悬空的项。

## 风险
- GitHub 账号或 App 授权不足；无法获取主分支历史。
- A/B 题库数量和模式不同，原始内容不能直接覆盖。
- 真实录音、转写、AI 评分均尚未在 A 原型中实现。
- 仅本地结构测试与成员 A 人工 6 项测试；未覆盖跨浏览器麦克风。
- 第五轮更新与残留：
  - 「真实录音、转写、AI 评分均未实现」这一条已部分失效：录音、转写服务、评分适配与报告渲染均已落地，但**真实 API 联网路径仍未实现验证**（无 Key）。
  - CI 用 Node 22、本机实测用 Node 26，尚未在同一环境用 22 复跑。
  - 5173 现状（本轮末尾复测）：桌面上那份旧项目副本（预览服务的 `--directory` 指向桌面旧目录）已不再占用 5173；当时 IPv4 `127.0.0.1:5173` 与 IPv6 `[::1]:5173` 各有一个服务进程（一个是你的预览窗口，一个是本轮为不干扰你而起的临时服务）。**具体 PID 属于运行时临时事实，由 `启动预览.bat` 或 `netstat -ano` 现场列出，不写进交付文档**；当时的实测结论是**两个地址返回的 `index.html` / `app.js` / `services/ai-pipeline.js` 与仓库文件字节完全一致**，即打开哪个都是新代码。`启动预览.bat` 仍保留占用检测，防止以后再撞端口时误开旧版本；端口必须保持 5173（AI 服务的 CORS 白名单只认它）。
  - 录音时长可能长于计划阶段时长，尾音会一起转写。
  - `停止 AI 后端.bat` 会结束占用 3001/3002 的 Node 进程，已加进程号列出 + 输入 `Y` 确认 + `node.exe` 镜像名校验，但仍需人工核对 PID。
  - Safari / Firefox 的 `MediaRecorder` 行为未验证。**百炼补丁把这个风险具体化了**：`qwen3-asr-flash` 的官方格式表不含 m4a/mp4/mov，Safari 录音在 bailian 通路上会返回 415；官方替代模型 `qwen-audio-3.1-asr-flash` 只走 DashScope 原生协议，本轮未实现。本地演示请固定用 Chrome 或 Edge。
  - 百炼通路特有的未确认项（补丁后收窄）：~~`{WorkspaceId}` 真实值~~ 已不再需要（默认地址由 B 实测通过）、~~`{type:"null"}` 能否被 `strict:true` 接受~~ 已在 responses 通路上被 B 的成功调用间接证实。仍然悬空的是：**这把 Key 的业务空间是否开通 `qwen3-asr-flash`**（唯一必须真实调用或控制台确认的项）；思考档位 `xhigh→低档` 对评分质量的影响；chat 备用通路从未真实验证；真实 401/403/429 失败形态仍只有离线模拟。
  - **两份 responses 报文实现并存**：B 的 `modules/ai-scoring/src/provider.mjs`（打 OpenAI）与 `src/bailian-provider.mjs`（打百炼）形状相同、各写一份，存在漂移风险。判定标准是三通路 `deepEqual` parity 测试；B 的代码同步进来后应以 B 为准，必要时抽出公共构造函数、删掉百炼文件里的重复分支。
  - **59 秒实测贴着 120 秒服务端上限**：约一倍余量，百炼排队或档位上调仍可能 504；改超时必须「服务端 < 前端」两端同步（120000/150000、90000/120000 已写进注释与 `.env.example`）。
  - B 侧讨论 3 分钟贴着 ASR 的 5 分钟上限：阶段延长或尾音会触发 413 `AUDIO_TOO_LONG`（明确报错、不截断），需要更长录音时要另做分段提交方案。
  - 端口 `3001/3002` 上如果还挂着本轮改动之前启动的旧进程，百炼配置不会生效；需要关掉旧窗口再双击 `启动 AI 后端.bat`（AI 不会代关，避免误杀无关进程）。

## 开发边界（黑客松约束，2026-11-21 补充）
- 本项目参加黑客松，目标限定为 **Windows 本地运行 + 完整功能演示 + 按时提交材料**；演示链接形式待比赛规则确认，**当前不执行任何部署**。
- 明确不做：Vercel/Netlify/Render/Railway/云服务器等公网部署；购买域名、云数据库、云主机或其他付费操作；未经批准使用真实 API Key 或产生付费 AI 调用；自动 Commit/Push/PR/改 `main`；引入 CDN、第三方脚本或统计。
- 明确保留：两个 Node.js 本机服务（仅监听 `127.0.0.1:3001/3002`）与 Windows 一键启动（`启动 AI 后端.bat` / `停止 AI 后端.bat`）；用户必须能在本机打开网页并完成录音 → 转写 → 评分 → 报告的核心操作。
- 实测核对（2026-11-21 Responses 对齐补丁收尾时重跑，非沿用上次结论）：仓库内无任何部署清单文件（`vercel.json`/`netlify.toml`/`render.yaml`/`railway.json`/`Dockerfile` 全部 0 命中）；CI 仅 `validate.yml`（结构校验 + 前端服务层 + 两个模块 `npm test`，全部离线）且 grep 无 deploy/publish 步骤；全仓只有两份 `.env.example`、**没有 `.env` 实体文件**；`sk-` 形态密钥串全仓 **0 处**；`.env.example` 只有空值与占位符；本轮新起的临时服务实测 `/health` 均返回 `keyConfigured/aiKeyConfigured=false`，验完已关闭。
- 需要用户批准才能进行的外部操作清单已单列在 `docs/round5-delivery-report.md` 第 9 节 + 本次补丁新增一项（`tools/asr-smoke.mjs` 的真实 ASR 冒烟，约 0.00044 元），**至今一项都未执行**。

## 更新规则
- 每次合并后更新：已完成、测试方法/结果、阻塞、下一步、最新通过测试 commit SHA。
- 不得将尚未测试的功能标为通过；协议变更需同步 Schema、示例、测试和版本。
