/*
 * TOPE Mate 考试流程配置
 * 所有时间单位为「秒」。改完保存，刷新浏览器即可生效。
 * 页面上的「考试设置」只做临时覆盖，不会改写本文件。
 */
window.TOPE_CONFIG = {
  version: 1,

  /* TOPE C：单人测试 —— 10 分钟准备 + 3 分钟演讲 + 2 分钟问答 */
  C: {
    label: "TOPE C",
    subtitle: "即兴演讲 + 问答（单人测试）",
    phases: [
      /* record: 该阶段是否调用麦克风录音（配置项，可在 config 里直接改） */
      { key: "prepare", name: "准备时间", en: "Preparation", seconds: 600, record: false, hint: "写提纲：开头逐字写好，主体只写 topic sentence 和关键词。" },
      { key: "speech",  name: "3 分钟演讲", en: "Speech",     seconds: 180, record: true,  hint: "开头 30–40 秒，2–3 个分论点，结尾重申中心论点。", warnAtRemaining: 30 },
      { key: "qa",      name: "问答环节", en: "Q&A",          seconds: 120, record: true,  hint: "考官会针对你的演讲追问，回答要完整，不要只说 Yes / No。" }
    ],
    /* 问答环节随机抽取的示例考官提问（原型阶段为固定题库，非 AI 生成） */
    qaPrompts: 4
  },

  /* TOPE B：陈述与讨论 —— 自我介绍 + 1 分钟准备 + 1.5 分钟个人陈述 + 小组讨论 */
  B: {
    label: "TOPE B",
    subtitle: "自我介绍 + 个人陈述 + 小组讨论（三人一组）",
    phases: [
      { key: "intro",        name: "自我介绍", en: "Self-introduction", seconds: 40,  record: true,  hint: "覆盖 study / interests / hobbies / personality，控制在 40 秒。" },
      { key: "prepare",      name: "1 分钟准备", en: "Preparation",     seconds: 60,  record: false, hint: "只看自己卡片上的角度，列 3 个分论点关键词。" },
      { key: "presentation", name: "个人陈述", en: "Presentation",      seconds: 90,  record: true,  hint: "开篇点题 + 分论点举例 + 结尾复述，注意别超时。" },
      { key: "discussion",   name: "小组讨论", en: "Group discussion",  seconds: 300, record: true,  hint: "原型阶段为单人自问自答练习，可先复述题目再表态。" }
    ],
    qaPrompts: 3
  },

  /* 界面与提醒行为 */
  ui: {
    sound: true,              // 阶段结束与 30 秒提醒是否响铃
    showChineseHint: true,    // 题目下方是否显示中文提示
    tickIntervalMs: 100,      // 倒计时刷新间隔
    transitionMs: 1600,       // 阶段自动切换时的过场提示时长
    drillKeepTimers: true,    // 话题专项练习是否同样使用倒计时
    recordAudio: true         // 是否开启麦克风录音（各阶段由上面的 record 决定）
  },

  /* 语音转写与 AI 评分服务。留空 = 页面上显示「尚未接入」，前端不会伪造结果。
     本地联调：先起 3001 评分服务，再起 3002 转写服务，两个都只监听 127.0.0.1。
     API Key 只放在服务端环境变量里，永远不要写进本文件。
     具体用 OpenAI 还是阿里云百炼由服务端环境变量（SCORING_PROVIDER / TRANSCRIBE_PROVIDER）决定，
     这里的 provider 只用于页面展示，真实值以两个 /health 返回的 data.provider 为准。 */
  services: {
    transcribeEndpoint: "http://127.0.0.1:3002/api/transcribe",
    transcribeProvider: "openai 或 阿里云百炼（由服务端 TRANSCRIBE_PROVIDER 决定）",
    evaluateEndpoint: "http://127.0.0.1:3001/api/evaluate",
    evaluateProvider: "openai 或 阿里云百炼（由服务端 SCORING_PROVIDER 决定）",
    healthEndpoints: {
      transcribe: "http://127.0.0.1:3002/health",
      evaluate: "http://127.0.0.1:3001/health"
    },
    sendAudioToBackend: true, // 转写请求是否附带音频 blob
    requiresTranscript: true, // 评分是否必须先有转写文本
    /* 前端超时必须大于服务端超时，让后端返回结构化错误而不是浏览器静默中断。
       实测：百炼 qwen3.8-flash 真实评分单次 59.09 秒（思考默认开启），服务端默认 120 秒。 */
    requestTimeoutMs: { transcribe: 120000, evaluate: 150000 },
    maxAudioBytes: 12 * 1024 * 1024 // 与转写服务默认上限一致，先在前端拦一道
  },

  /* A 内部阶段键 → 评分 Schema 1.4.0 的 stage。prepare 没有口头产出，不提交评分。 */
  scoringStages: {
    intro: "self_intro",
    presentation: "statement",
    discussion: "discussion",
    speech: "speech",
    qa: "qa"
  },

  /* 评分请求携带的官方量表版本标签（只是版本标识，不是权重来源）。 */
  scoring: {
    rubric: "ruc_tope_official_bands_v1",
    language: "en",
    /* 报告页维度顺序与中文名。真实分数来自 data.scores，权重来自 data.scorePolicy.configuredWeights，
       这里只负责展示顺序与标签；未列出的维度按返回顺序追加。 */
    dimensionLabels: {
      relevance: "切题与内容",
      organization: "结构组织",
      development: "论证与展开",
      language: "语言表达",
      interaction: "互动能力",
      taskCompletion: "任务完成",
      timeManagement: "时间控制"
    },
    peelLabels: { point: "观点 Point", explain: "解释 Explain", example: "例子 Example", link: "回扣 Link" },
    peelStatusLabels: { present: "已做到", partial: "部分做到", absent: "未做到", not_assessed: "本阶段不评估" }
  },

  /* 报告页：第一阶段为示例数据，不接入真实 AI */
  report: {
    isSampleData: true,
    dimensions: [
      { key: "content",     name: "内容与论证", en: "Content",     weight: 0.35 },
      { key: "organization",name: "结构脉络", en: "Organization", weight: 0.30 },
      { key: "language",    name: "语言表达", en: "Language",      weight: 0.25 },
      { key: "delivery",    name: "呈现与流畅", en: "Delivery",    weight: 0.10 }
    ]
  }
};
