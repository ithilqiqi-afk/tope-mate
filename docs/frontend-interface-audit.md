# TOPE Mate 前端接口审查（A）

- 审查基线：2026-11-21 上传的 Qoder 原型 `app.js`、`index.html`、`config/exam-config.js`、`data/questions-{b,c}.js`、`data/report-samples.js`。
- 测试证据：成员 A 在本地报告首页、C 完整模拟抽题、10 秒计时切换、暂停/继续/提醒、示例报告、B 三卡显示共六项通过。
- 本文只描述现有真实代码；B 的 139 道 C 候选题、28 套 B 候选题及评分原型尚未获得实际文件，**未完成对 B 文件的字段级对比**。

## 1. 数据加载与目录

`index.html` 依次通过 `<script>` 引入 `config/exam-config.js`、`data/questions-c.js`、`data/questions-b.js`、`data/report-samples.js`、`app.js`。所有文件给 `window` 赋值，**没有 JSON fetch 或后端 API**。`app.js` 入口读取 `window.TOPE_CONFIG`、`window.TOPE_CATEGORIES`、`window.TOPE_BANK_C.questions`、`window.TOPE_BANK_B.sets`、`window.TOPE_QA_SAMPLES`、`window.TOPE_REPORT_SAMPLES`。如要使用 B 的 `.json`，建议先通过构建时数据转换或在 `app.js` 启动之前注入兼容对象；不要原地把 `.js` 改成 JSON 却继续用 `<script src>` 引入。

## 2. TOPE C 题库

- 容器：`window.TOPE_BANK_C = {version: string, questions: Array}`；现有 196 条记录。
- 每题实际字段：`{id: string, cat: string, en: string, zh: string}`。没有 `source`、`tags`、独立 `followUps` 或题目级计时。
- 分类：`window.TOPE_CATEGORIES` 是 `{key,name,en,desc}[]`，仅五类：`society_tech`、`culture_tradition`、`study_campus`、`life_relationship`、`career_growth`；原产品规划的 `other` 尚未实施。
- `Bank.list(type, category)` 通过 `q.cat === category` 筛选；`Bank.draw` 使用 `Math.random()` 从未见过 ID 的集合随机抽取，耗尽后清空对应考试类型的 `seen` 集合。指定分类为空时**静默回退全部题库**。这不是跨刷新持久去重。
- `prepareItem()` 存入 `S.item`；C 显示逻辑 `topicCardHtml()` 用 `item.en / item.zh / item.id / item.cat`。
- `buildQA()` 对所有题均从 `window.TOPE_QA_SAMPLES.general` 和 `window.TOPE_QA_SAMPLES[item.cat]` 抽出模板追问；**并非根据题目或回答内容生成的追问**，每道 C 题没有专属追问字段。
- B 题库接入：先在 `services/question-bank-adapter.js`（未来文件）做 `normalizeCQuestion(raw)`，将 B 数据映射为上述字段；需双方确定 ID 唯一规则、翻译文本、出处分类、追问优先级。若使用异步 fetch，必须先加载完成再启动 `app.js`。在未确认 B 源结构前不可假定字段名称。

## 3. TOPE B 题组

- 容器：`window.TOPE_BANK_B = {version, selfIntro, sets}`；现有 22 组。`selfIntro` 为 `{requirement,requirementZh,outline[]}`。
- 题组字段：`{id,cat,topic,topicZh,cards,discussion,discussionZh,followUps}`。
- `cards` 三条：`{key:'A'|'B'|'C',point,pointZh}`；`followUps` 三条：`{key:'A'|'B'|'C',q}`。
- `prepareItem()` 随机生成 `S.cardKey`；`topicCardHtml()` 通过 `item.cards.find(c => c.key === S.cardKey)` 选择考生卡，页面同时显示三张卡；`sidePanelHtml` 的 `discussion` 分支读 `S.item.discussion / discussionZh`；`buildQA()` 取考生相应 follow-up 再附加通用模板追问。
- 计时来自 `window.TOPE_CONFIG.B.phases`，固定 `presentation.seconds=90`；**没有题组级 `90/120` 覆盖**。实现需定义可选 `presentationSeconds` 并在开始会话时派生不可变的阶段配置，避免影响其余题组。
- 图片题卡：当前无图片字段与展示逻辑；建议可选 `image: {src,alt,credit?}`，限制可信资源路径并补充 `topicCardHtml()` 图片渲染及缺失备用文本。图片资源路径和版权来源须 B 确认。

## 4. 报告（纯本地示例）

- `config.report = {isSampleData:true, dimensions:[{key,name,en,weight}]}`。当前维度 `content=.35`、`organization=.30`、`language=.25`、`delivery=.10`，B/C 共用。
- `window.TOPE_REPORT_SAMPLES = {disclaimer,overall:[{min,label,text}],dimensions:{content|organization|language|delivery:[{min,good,bad}]},nextSteps:{维度key:[string]}}`。
- `buildReport()` 使用题目 ID、考试类型与起始时间分钟级种子生成伪随机分数；用演讲时长比例略微调整，**未分析真实音频/转写**。返回对象：`{overall:number,band:string,bandText:string,scores:Record<dimensionKey,number>,dimDetail:Record<dimensionKey,{min,good,bad}>,weakest:{key,name,en,weight},nextStep:string,ratio:number,duration:number}`。
- `routes.report()` 读取 `r.overall/band/bandText/scores/dimDetail/weakest.name/nextStep/ratio/duration`，并读取 `S.phaseLog` 用时、`S.item` 题目。它**没有**展示 `strengths`、`weaknesses`、`suggestions[]`、`evidence[]`、`peel`、`improvedExpressions[]` 的组件，也没有接收 AI 接口的实现。
- 建议保留 `buildReport` 为 `sample` 模式，另加 `normalizeEvaluation(raw)` 适配 B 的结果到统一报告展示模型；新增证据/PEEL/改进表达区块，禁止给真实分数套用伪随机内容。评分尺度、空缺维度、文字证据必须按双方协议规定。
- Delivery 示例中存在“眼神交流/手势/发音停顿”等**无法仅凭转写文本判断**的语句，真实评分必须不展示这类未经观察的结论。

## 5. 考试流程与录音

- 状态对象 `S` 维护 `examType/mode/category/item/cardKey/phaseIndex/phaseLog/notes/qa/startedAt/finishedAt/report`。
- `Timer` 使用绝对截止时刻和累计运行时长，提供 `start/arm/pause/resume/stop/tick/elapsedOfPhase`；`startSession()` 组装 `phaseLog`，`runPhase()` 开始计时，`advance()` 推进阶段，`endSession()` 生成示例报告。
- `phaseLog` 条目 `{key,name,planned,actual,status}`；`actual` 是计时器的阶段记录（秒）。提前离开阶段可能为较短实际时长。
- **完全没有** `MediaRecorder`、`getUserMedia`、Blob/File 采集或上传逻辑，考试后**无法获得真实录音文件**。`S.notes` 只是提纲，**不是 transcript**。
- 待录音模块提供 `{examType,stage,audioBlob,mimeType,durationSeconds}`；待转写提供 transcript；待评分调用使用 `{examType,question,stage,transcript,durationSeconds,rubric}`。可在 `endSession()` 后串联异步任务，但先等待 MediaRecorder `dataavailable/stop` 完成，独立处理每阶段与失败状态。

## 6. 风险与具体修改位置

| 风险 | 位置 | 推荐处理 |
|---|---|---|
| 资源缺失在自检前抛异常 | `Bank.cList/bList` 初始化、`sanityCheck()` | 推迟字段解引用，先检查依赖 |
| 设置保存时误停止当前会话 | `openSettings()` 调用 `go(currentRoute)`、`go()` 的 `Timer.stop()` | 考试过程中阻止重进入口或仅更新非计时 UI；明确下轮生效 |
| 阶段提醒覆盖项仅在内存生效 | `applyWarnOverrides()` | 保持读取 `Cfg.data` 时统一应用覆盖值 |
| 完整模拟可按分类选题 | `routes.mode/category` | 根据已确定产品规则将完整模拟默认设 all，或确认用户主动指定分类是否被允许 |
| 专项练习默认仍走全阶段 | `startSession()`、`phases()` | 增加选定阶段的会话级 phase list，勿修改全局配置 |
| B 单题独立时长/图片缺失 | `topicCardHtml()`、`phases()` | 由 B 提供字段规范后添加适配 |
| 报告纯样例且缺证据区块 | `buildReport()`、`routes.report()` | 两种报告模式分离；适配层 + 渐进渲染 |
| 切换过程中任何异步录音结束 | `advance()/endSession()` | 等待录音停止完成后再转写；捕获权限错误 |
| 不可信题库宣称“历年真题” | `routes.home()`、`index.html` 页脚、使用说明 | 修改宣传用语需 B 审核来源再确定 |

## 7. B 需要确认的输入

1. **实际** B/C JSON 示例与字段定义、ID/类别映射、出处与认证状态、每题追问结构、图片资源信息。
2. 评分请求/响应的实际代码与示例，分数范围、维度权重、错误码及 null 处理，是否区分 B/C 和阶段。
3. 转写接入方案、支持的音频 MIME/大小限制及服务端密钥管理。

第 2、3 项已由 B 提供实际源码与样例：评分契约冻结在 Schema 1.4.0（`modules/ai-scoring/docs/api_contract.md`），转写契约见 `modules/speech-transcription/docs/transcribe_api.md`。本文写作时 `docs/contracts` 的**候选 v0.1 已废弃**，其中记录的字段差异保留在 `docs/contracts/README.md` 的映射表里，仅供理解历史代码用。第 1 项的题库出处与认证状态仍待审核。
