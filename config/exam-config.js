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

  /* 语音转写与 AI 评分：当前留空 = 页面上显示「尚未接入」。
     填上你自己后端的地址才会真的发请求；密钥只放后端，不要写进前端文件。 */
  services: {
    transcribeEndpoint: "",   // 例："http://127.0.0.1:8787/api/transcribe"
    transcribeProvider: "",   // 例："xf-iOS / aliclou / whisper"
    evaluateEndpoint: "",     // 例："http://127.0.0.1:8787/api/evaluate"
    evaluateProvider: "",
    sendAudioToBackend: true, // 转写请求是否附带音频 blob
    requiresTranscript: true  // 评分是否必须先有转写文本
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
