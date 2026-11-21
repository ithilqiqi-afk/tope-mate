# TOPE Mate · A 的第一阶段原型

中国人民大学 TOPE B/C 口语练习网页。原生 HTML/CSS/JS，无框架、无构建步骤。报告页分两种：本地示例数据，以及按阶段提交给本机转写/评分服务的真实 AI 分析。

## 运行

- Windows 只用页面（不联调 AI）：双击 `启动预览.bat`（需要 Python 或适用的系统启动环境）；5173 被别的本地服务占用时它会先列出进程号并停下来，避免误开旧副本；
- **只在 Windows 本机运行，不做任何部署**：不接 Vercel/Netlify/Render/Railway/云服务器，不买域名、不建云数据库、不产生付费调用；两个 Node 服务只监听 `127.0.0.1`，CI 里没有发布步骤。需要公网演示链接时先确认方案再动手；
- Windows 联调本机服务：双击 `启动 AI 后端.bat` 会开两个窗口——评分 `127.0.0.1:3001`、转写 `127.0.0.1:3002`；两个模块零依赖，**不需要 `npm install`**，也不会访问 npm 源；要停就双击 `停止 AI 后端.bat`（会先列出 Node 进程号并等你确认 Y）或直接关掉那两个窗口；
- 启动窗口里失败一定带原因（目录缺失 / node 不在 PATH / 入口文件缺失 / 端口被占 / `.env` 读不了），不会闷声退出；逐条处理办法见 `使用说明.md`「接入真实语音转写与 AI 评分」；
- 第一次联调前，把 `modules/ai-scoring/.env.example` 和 `modules/speech-transcription/.env.example` 各自复制成同目录的 `.env` 再填 Key。`.env` 已被 `.gitignore` 排除，真实密钥不要提交、不要贴进日志或截图；
- 没有 Key 也能走完流程：服务照常启动，报告页会写清失败原因（`API_KEY_MISSING` 等），不会伪造转写文本或分数；
- 跨平台：项目根目录运行 `python -m http.server 5173`，浏览器访问 `http://127.0.0.1:5173/`；
- 验证：`node tests/validate.cjs` 与 `node tests/frontend-services.cjs`（需要 Node.js 18+，全程离线、不需要 API Key，也不测试麦克风）。

本移交包基于 A 已在本地人工通过六项流程测试的源码，不包含 B 的未提供候选题库。**上传前请先克隆真实共享仓库，检查其 README 与现有内容，并按差异手动合并**，不要解压覆盖远端仓库。

- 接口审查：[`docs/frontend-interface-audit.md`](docs/frontend-interface-audit.md)
- 协作状态：[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
- 评分契约（已冻结 Schema 1.4.0，v0.1 候选已废弃）：[`docs/contracts/`](docs/contracts/)
- 语音转写服务：[`modules/speech-transcription/`](modules/speech-transcription/)
- AI 评分服务：[`modules/ai-scoring/`](modules/ai-scoring/)
- 轻量协作制度：[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
