# 候选接口契约 v0.1 — 未冻结

此处是用于 A/B 对齐的候选规范，**未见到 B 的真实源码或 JSON**，不得视为已经双方认可的最终协议。

- `question-c.schema.json` / `question-b.schema.json`：面向 A 原生结构的过渡 Schema，兼容现有题库，额外字段可选。
- `evaluation-request.schema.json` / `evaluation-response.schema.json`：双方讨论用评分输入输出候选。
- `fixtures/`：样例均为虚构测试文本，不代表已做真实 AI 评价。

约定建议：分数统一 0~100；未能观察的维度使用 `null` 并解释 `notAssessed`；`evidence` 必须指向 transcript 原文（不制造内容）；`peel` 仅适用于可分析的 speech/presentation；真实发音质量不能仅靠文本判断。出错时采用独立 `{success:false,error:{code,message}}` 结构，不混入成功响应。题目 `source` 应保留原始出处及审核状态，未审核时禁止宣称正式真题。

B 需提供实际样例后，记录映射表，双方确认、升级版本并正式冻结。
