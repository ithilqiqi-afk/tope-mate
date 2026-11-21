/*
 * 报告页与问答环节的示例素材
 * 第一阶段不接入真实 AI：这里的所有文字反馈都是模板文案，报告页会明确标注「示例数据」。
 */

/* Q&A 环节随机考官提问（通用追问模板，按题目分类给出） */
window.TOPE_QA_SAMPLES = {
  general: [
    "You mentioned a personal experience. Could you tell us more about it?",
    "What would you say to someone who completely disagrees with you?",
    "Do you think this is true for everyone, or only for people of your generation?",
    "Can you give one concrete example that supports your main point?",
    "What is the strongest argument against the opinion you just gave?",
    "If you had to change one thing about this situation, what would it be?",
    "How is this different in China compared with other countries?",
    "What do you think will change about this in ten years?"
  ],
  society_tech: [
    "Would you personally give up this technology for a month? Why or why not?",
    "Who should be responsible if this technology causes harm?",
    "Do you think your parents would agree with what you just said?"
  ],
  culture_tradition: [
    "Which Chinese tradition do you think is most worth keeping?",
    "How would you explain this to a foreign friend in one sentence?",
    "Is it possible to preserve tradition while modernising?"
  ],
  study_campus: [
    "What would you do differently next semester after saying this?",
    "Do you think RUC should do more about this? What exactly?",
    "Has any teacher influenced your view on this?"
  ],
  life_relationship: [
    "Can you describe a moment when you really felt this?",
    "Do you think happiness depends mostly on ourselves?",
    "What advice would you give to a friend struggling with this?"
  ],
  career_growth: [
    "Would your answer change five years from now?",
    "What is the first step you would take tomorrow morning?",
    "Do you think salary should be the main standard for a good job?"
  ]
};

/* 报告页示例文案：按分数区间给出，保证文案与分数方向一致 */
window.TOPE_REPORT_SAMPLES = {
  disclaimer: "本报告中的分数与文字反馈由本地模板按固定规则生成，属于示例数据，未接入真实 AI 语音识别或评分模型，不代表 TOPE 官方评分。",

  overall: [
    { min: 90, label: "优秀", text: "结构完整、论点清晰，具备拿到高分档的基础。重点打磨语言准确度与例子的具体度。" },
    { min: 80, label: "良好", text: "整体框架成立，考官能跟上你的思路。下一步是把分论点讲透，而不是罗列。" },
    { min: 70, label: "中等", text: "完成了基本任务，但开头与结尾的标记不够明显，考官需要自己找你的结构。" },
    { min: 60, label: "及格边缘", text: "内容能听明白，但结构、时长控制和语言准确度都有明显失分点，建议先练框架再练词汇。" },
    { min: 0,  label: "待提高", text: "本次练习暴露的主要问题是不敢开口展开：先用固定模板把 3 分钟说满，再谈质量。" }
  ],

  dimensions: {
    content: [
      { min: 85, good: "分论点与中心论点绑定紧密，例子具体到人和场景。", bad: "论点与中心论点关联偏弱。" },
      { min: 70, good: "有 2–3 个分论点，方向正确。", bad: "例子偏抽象，多用「比如我的朋友」这类可展开的具体素材。" },
      { min: 0,  good: "论点数量足够，但论证停留在口号层面。", bad: "先保证每个分论点都有「观点句 + 一个例子 + 一句分析」。" }
    ],
    organization: [
      { min: 85, good: "开头—主体—结尾三段式非常清楚，连接词使用自然。", bad: "结尾可再明确一句 To summarize，避免戛然而止。" },
      { min: 70, good: "整体顺序合理，考官容易跟读。", bad: "分论点之间缺少 Let's start with... / Then we move on to... 这类明示路标。" },
      { min: 0,  good: "能听出你在按要点讲。", bad: "结构信号太弱：开头必须明确抛出中心论点，不能靠考官猜。" }
    ],
    language: [
      { min: 85, good: "用词准确，句式有变化，时态基本稳定。", bad: "个别搭配可再地道一些，注意单复数与冠词。" },
      { min: 70, good: "表达流畅，能完成交流任务。", bad: "I think 出现频率过高，可替换为 figure / reckon / suppose。" },
      { min: 0,  good: "关键词基本覆盖话题。", bad: "先放慢语速换准确度：宁可句子短而正确，不要长而破碎。" }
    ],
    delivery: [
      { min: 85, good: "语速稳定，与考官有眼神交流，没有全程念稿。", bad: "手势可以再自然一些，用来强调分论点。" },
      { min: 70, good: "整体自信，紧张感不明显。", bad: "开头 15 秒有明显的找词停顿，建议把开头逐字背熟。" },
      { min: 0,  good: "声音清晰可辨。", bad: "避免全程低头看提纲；忘词时放慢语速而不是沉默。" }
    ]
  },

  /* 下一步练习建议池，报告页按最低分维度挑选 */
  nextSteps: {
    content: ["用「观点句 + 例子 + 一句分析」重写今天两个分论点，再讲一遍。", "同一个题目连讲三遍，每一遍强制换一个不同的例子。"],
    organization: ["只练开头 40 秒：争议引入 + 过渡句 + 中心论点，练到形成肌肉记忆。", "写提纲时只允许写 topic sentence，不许写整句稿。"],
    language: ["把今天稿子里的 I think 全部替换成别的表达再讲一遍。", "挑 10 个万能句型（如 It's worth noting that...）做造句练习。"],
    delivery: ["录音回听一次，只统计停顿超过 2 秒的次数。", "对着墙讲，练习不看提纲完成结尾总结。"]
  }
};
