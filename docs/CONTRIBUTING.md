# 两人轻量协作规则

- `main`：可运行且通过基础测试，A 负责合并；不强推、不覆盖历史。
- `feature/question-bank`：B 管理题库、来源和校验；`feature/ai-scoring`：B 管理评分和测试。
- A 的录音功能使用 `feature/recording` 等独立分支。
- 每次开始：`git pull --ff-only` 或检查最新远程文件和 `docs/PROJECT_STATUS.md`、`docs/contracts/`。
- 修改契约：先 Issue/PR 讨论，更新版本、Schema、fixtures、测试；双方同意后合并。
- 每个 PR：描述修改、影响模块、测试命令和结果、演示步骤；通过自动测试后由 A 人工验收并合并。
- A 不直接覆盖 B 的题库和评分源码；B 不直接改 A 的主流程，跨模块通过 PR 协调。
- 禁止向仓库提交 API 密钥、访问令牌、录制的个人语音、含个人数据的样例；敏感配置仅放服务端环境变量。
- 若仓库已有 README、目录、开发内容，先比对冲突，**不要用本包直接覆盖**。
