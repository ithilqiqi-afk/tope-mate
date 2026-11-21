# TOPE Mate · A 的第一阶段原型

中国人民大学 TOPE B/C 口语练习网页。原生 HTML/CSS/JS，**评分仅为本地示例**；尚无语音录制、转写、真实 AI 评分。

## 运行

- Windows：双击 `启动预览.bat`（需要 Python 或适用的系统启动环境）；
- 跨平台：项目根目录运行 `python -m http.server 5173`，浏览器访问 `http://127.0.0.1:5173/`；
- 验证：`node tests/validate.cjs`（需要 Node.js 18+，仅测试结构与数据，不测试麦克风）。

本移交包基于 A 已在本地人工通过六项流程测试的源码，不包含 B 的未提供候选题库。**上传前请先克隆真实共享仓库，检查其 README 与现有内容，并按差异手动合并**，不要解压覆盖远端仓库。

- 接口审查：[`docs/frontend-interface-audit.md`](docs/frontend-interface-audit.md)
- 协作状态：[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
- 契约候选（未冻结）：[`docs/contracts/`](docs/contracts/)
- 轻量协作制度：[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
