/*
 * TOPE B 题库（陈述与讨论）
 * 每组包含：大主题 topic + 三张卡片 cards（A/B/C 角度）+ 讨论题 discussion + 追问 followUps
 * 结构：{ id, cat, topic, topicZh, cards[], discussion, discussionZh, followUps[] }
 */
window.TOPE_BANK_B = {
  version: "2026-11-21",

  /* Part I 自我介绍：固定要求，40 秒左右 */
  selfIntro: {
    requirement: "In your introduction you should tell us something about your study, interests, hobbies, personality, and so on.",
    requirementZh: "自我介绍需覆盖：专业与学习、兴趣爱好、性格特点等，约 40 秒。",
    outline: [
      "Greeting + name + major + hometown（10 秒）",
      "Study：一门印象最深的课 / 一个正在做的学术兴趣（12 秒）",
      "Interests & hobbies：一两个具体例子，别只报菜名（10 秒）",
      "Personality：用一个小事说明，而不是直接说形容词（8 秒）"
    ]
  },

  sets: [
    {
      id: "b01", cat: "society_tech",
      topic: "What problems does overpopulation bring?", topicZh: "人口膨胀带来哪些问题？",
      cards: [
        { key: "A", point: "Environmental pollution", pointZh: "环境污染" },
        { key: "B", point: "Shortage of resources", pointZh: "资源短缺" },
        { key: "C", point: "The gap between the rich and the poor", pointZh: "贫富差距" }
      ],
      discussion: "Which is a bigger threat to the world, overpopulation or under-population?",
      discussionZh: "对世界而言，人口膨胀与人口不足哪个威胁更大？",
      followUps: [
        { key: "A", q: "What do you think of the \"one child per family\" policy to control population growth?" },
        { key: "B", q: "Do you think sustainable population growth is more important for the developed or developing countries? Why?" },
        { key: "C", q: "Do you think an ageing population has positive or negative effects on society? Why?" }
      ]
    },
    {
      id: "b02", cat: "society_tech",
      topic: "Why do people immigrate to other countries?", topicZh: "人们为什么移民到其他国家？",
      cards: [
        { key: "A", point: "Education opportunity", pointZh: "教育机会" },
        { key: "B", point: "Natural disasters", pointZh: "自然灾害" },
        { key: "C", point: "Marriage", pointZh: "婚姻" }
      ],
      discussion: "Should immigrants culturally assimilate or preserve their own culture?",
      discussionZh: "移民应当融入当地文化，还是保留自身文化？",
      followUps: [
        { key: "A", q: "What challenges do you think an immigrant may face in a new country?" },
        { key: "B", q: "Do you think immigrants should be educated in their original language or the local language?" },
        { key: "C", q: "Have you considered emigrating? If you were to emigrate, where would you go? Why?" }
      ]
    },
    {
      id: "b03", cat: "culture_tradition",
      topic: "How to boost China's cultural soft power?", topicZh: "如何提升中国的文化软实力？",
      cards: [
        { key: "A", point: "Increasing cultural exchange", pointZh: "加强文化交流" },
        { key: "B", point: "Exporting cultural products", pointZh: "输出文化产品" },
        { key: "C", point: "Promoting tourism", pointZh: "发展旅游" }
      ],
      discussion: "How to preserve and promote China's traditional culture?",
      discussionZh: "如何保护并弘扬中国传统文化？",
      followUps: [
        { key: "A", q: "What aspect(s) of American culture do you like?" },
        { key: "B", q: "If you were given the chance to work in a Confucius Institute in a foreign country, would you take it? Why or why not?" },
        { key: "C", q: "If you are to introduce a symbol representing Chinese culture to a group of American college students, what symbol would you like to talk about?" }
      ]
    },
    {
      id: "b04", cat: "study_campus",
      topic: "What are the aims of compulsory education?", topicZh: "义务教育的目标是什么？",
      cards: [
        { key: "A", point: "To encourage creativity", pointZh: "鼓励创造力" },
        { key: "B", point: "To build solid knowledge", pointZh: "打实知识基础" },
        { key: "C", point: "To develop social skills and character", pointZh: "培养社交能力与品格" }
      ],
      discussion: "What should be perceived as quality education for primary and secondary schools?",
      discussionZh: "中小学的\"素质教育\"应当是什么？",
      followUps: [
        { key: "A", q: "Do you think that everyone should go to college?" },
        { key: "B", q: "What is the biggest thing you have learnt after coming to college?" },
        { key: "C", q: "What is the one thing you would like to change about your college?" }
      ]
    },
    {
      id: "b05", cat: "study_campus",
      topic: "Why do we go to college?", topicZh: "我们为什么上大学？",
      cards: [
        { key: "A", point: "To have better job opportunities", pointZh: "获得更好的就业机会" },
        { key: "B", point: "To learn and explore subjects of our interest in depth", pointZh: "深入学习感兴趣的学科" },
        { key: "C", point: "To meet people and be more open-minded", pointZh: "结识他人、更开放" }
      ],
      discussion: "What is the real charm of college?",
      discussionZh: "大学真正的魅力是什么？",
      followUps: [
        { key: "A", q: "Is college education worth the cost?" },
        { key: "B", q: "What college students are expected to achieve besides academic performance?" },
        { key: "C", q: "One important thing you have learned at RUC." }
      ]
    },
    {
      id: "b06", cat: "culture_tradition",
      topic: "The contributions of international students", topicZh: "国际学生的贡献",
      cards: [
        { key: "A", point: "From the perspective of economic importance", pointZh: "经济层面的贡献" },
        { key: "B", point: "From the perspective of academic importance", pointZh: "学术层面的贡献" },
        { key: "C", point: "From the perspective of social, cultural and political importance", pointZh: "社会、文化与政治层面" }
      ],
      discussion: "What challenges do international students face?",
      discussionZh: "国际学生面临哪些挑战？",
      followUps: [
        { key: "A", q: "What are the most important factors in choosing a university?" },
        { key: "B", q: "What is your destination country if you choose to study abroad, and why?" },
        { key: "C", q: "Why do students pursue international study on a personal level?" }
      ]
    },
    {
      id: "b07", cat: "culture_tradition",
      topic: "How to develop intercultural communicative competence", topicZh: "如何培养跨文化交际能力",
      cards: [
        { key: "A", point: "Learning a foreign language", pointZh: "学习外语" },
        { key: "B", point: "Taking culture courses", pointZh: "修读文化课程" },
        { key: "C", point: "Travelling abroad", pointZh: "出国旅行" }
      ],
      discussion: "Are cultural differences a barrier or a bridge to mutual understanding?",
      discussionZh: "文化差异是隔阂还是理解彼此的桥梁？",
      followUps: [
        { key: "A", q: "What do you think is the most important thing to pay attention to in intercultural communication?" },
        { key: "B", q: "Should people learn about cultures other than their own?" },
        { key: "C", q: "Which Chinese saying do you think most foreigners know?" }
      ]
    },
    {
      id: "b08", cat: "study_campus",
      topic: "The advantages of online learning", topicZh: "在线学习的优势",
      cards: [
        { key: "A", point: "Effective time management", pointZh: "时间管理更高效" },
        { key: "B", point: "Combination of structure and freedom", pointZh: "结构自由相结合" },
        { key: "C", point: "Safe learning environment", pointZh: "安全的学习环境" }
      ],
      discussion: "Will online learning replace classroom learning in universities?",
      discussionZh: "在线学习会取代大学课堂吗？",
      followUps: [
        { key: "A", q: "Is online or in-person education better for students?" },
        { key: "B", q: "What self-discipline problems does online learning create for students?" },
        { key: "C", q: "How can teachers keep students engaged in an online class?" }
      ]
    },
    {
      id: "b09", cat: "career_growth",
      topic: "Challenges to young workers today", topicZh: "当今年轻职场人面临的挑战",
      cards: [
        { key: "A", point: "Competition from the ageing workers", pointZh: "来自年长员工的竞争" },
        { key: "B", point: "Accelerating advances in technology", pointZh: "技术加速迭代" },
        { key: "C", point: "Conflict between work and life", pointZh: "工作与生活的冲突" }
      ],
      discussion: "Are older workers less competitive than young workers?",
      discussionZh: "年长员工的竞争力是否不如年轻人？",
      followUps: [
        { key: "A", q: "Would you like to work with older employees, and why?" },
        { key: "B", q: "Will you be more worried by being replaced by robots or by other employees? Why?" },
        { key: "C", q: "What do you think helps to increase one's competitiveness in the workplace?" }
      ]
    },
    {
      id: "b10", cat: "study_campus",
      topic: "Teacher-student relationship", topicZh: "师生关系",
      cards: [
        { key: "A", point: "Students should always respect their teachers.", pointZh: "学生应始终尊重老师" },
        { key: "B", point: "The teacher should treat their students as friends.", pointZh: "老师应把学生当朋友" },
        { key: "C", point: "Teachers should be equal to their students.", pointZh: "师生应平等" }
      ],
      discussion: "What kind of teachers are good teachers in your mind?",
      discussionZh: "你心目中什么样的老师是好老师？",
      followUps: [
        { key: "A", q: "What kind of support from a teacher do you think is the most important for classroom learning?" },
        { key: "B", q: "Who is the teacher that you appreciate most in your schooling experience?" },
        { key: "C", q: "Why do Chinese students often keep silent in the classroom?" }
      ]
    },
    {
      id: "b11", cat: "career_growth",
      topic: "How to become more competitive in the job market?", topicZh: "如何在就业市场更有竞争力？",
      cards: [
        { key: "A", point: "Attending a prestigious university", pointZh: "上名校、选好专业" },
        { key: "B", point: "Obtaining qualifications or certificates", pointZh: "高学历、多证书" },
        { key: "C", point: "Getting relevant work experience", pointZh: "多实践、积累经验" }
      ],
      discussion: "Why is competition in the job market getting more and more fierce?",
      discussionZh: "就业市场竞争为何越来越激烈？",
      followUps: [
        { key: "A", q: "What will you do if you fail to find an ideal job?" },
        { key: "B", q: "Would you like to find a job in Beijing or in your hometown after graduation?" },
        { key: "C", q: "What kind of job would you like to have? Please give your reasons." }
      ]
    },
    {
      id: "b12", cat: "society_tech",
      topic: "How technology has changed the way we live", topicZh: "科技如何改变我们的生活方式",
      cards: [
        { key: "A", point: "It makes everyday life more convenient", pointZh: "让生活更便利" },
        { key: "B", point: "It changes the way people work", pointZh: "改变工作方式" },
        { key: "C", point: "It reshapes how people communicate", pointZh: "重塑交流方式" }
      ],
      discussion: "Does technology create more problems than it solves?",
      discussionZh: "技术制造的问题是否比解决的更多？",
      followUps: [
        { key: "A", q: "Can you live without a smartphone? Why or why not?" },
        { key: "B", q: "Will China become a cashless society in the future?" },
        { key: "C", q: "How can college students use AI wisely?" }
      ]
    },
    {
      id: "b13", cat: "society_tech",
      topic: "Social media and friendship", topicZh: "社交媒体与友谊",
      cards: [
        { key: "A", point: "It helps people keep in touch across distance", pointZh: "跨越距离保持联系" },
        { key: "B", point: "It reduces the time people spend face to face", pointZh: "减少面对面相处时间" },
        { key: "C", point: "It creates misunderstandings through text-only messages", pointZh: "纯文字交流易生误解" }
      ],
      discussion: "Does social media bring people closer or push them apart?",
      discussionZh: "社交媒体让人更亲近还是更疏远？",
      followUps: [
        { key: "A", q: "What do people enjoy about social media?" },
        { key: "B", q: "What makes a lasting friendship in the digital age?" },
        { key: "C", q: "Should people learn to spend a day without social media?" }
      ]
    },
    {
      id: "b14", cat: "life_relationship",
      topic: "Living in a big city or a small town", topicZh: "大城市与小城镇生活",
      cards: [
        { key: "A", point: "Career chances and higher income", pointZh: "更多机会与更高收入" },
        { key: "B", point: "Slower pace and lower cost of living", pointZh: "节奏更慢、成本更低" },
        { key: "C", point: "Closer community ties and a quieter life", pointZh: "社群关系更紧密、生活更安静" }
      ],
      discussion: "Is it better to struggle in the big city or relax in the simple life of small towns?",
      discussionZh: "在大城市奋斗好，还是在小城镇过简单生活好？",
      followUps: [
        { key: "A", q: "Do you prefer living in a small town or a big city after graduation?" },
        { key: "B", q: "What problems do people in big cities have to deal with every day?" },
        { key: "C", q: "What would you sacrifice for a simpler life?" }
      ]
    },
    {
      id: "b15", cat: "life_relationship",
      topic: "Healthy living among college students", topicZh: "大学生的健康生活",
      cards: [
        { key: "A", point: "Regular sleep schedule", pointZh: "规律作息" },
        { key: "B", point: "Balanced diet", pointZh: "均衡饮食" },
        { key: "C", point: "Regular exercise", pointZh: "坚持锻炼" }
      ],
      discussion: "Which matters more for health, diet or exercise?",
      discussionZh: "对健康而言，饮食与锻炼哪个更重要？",
      followUps: [
        { key: "A", q: "What aspects of healthy living do college students often forget?" },
        { key: "B", q: "How should you deal with stress in college life?" },
        { key: "C", q: "Why is it hard for students to keep a good habit?" }
      ]
    },
    {
      id: "b16", cat: "society_tech",
      topic: "Environmental protection", topicZh: "环境保护",
      cards: [
        { key: "A", point: "Government regulation and investment", pointZh: "政府监管与投入" },
        { key: "B", point: "Corporate responsibility", pointZh: "企业责任" },
        { key: "C", point: "Individual habits and lifestyle", pointZh: "个人习惯与生活方式" }
      ],
      discussion: "Who should bear the primary responsibility for environmental protection?",
      discussionZh: "环保的首要责任应由谁承担？",
      followUps: [
        { key: "A", q: "How do you view garbage sorting in Chinese cities?" },
        { key: "B", q: "Should wild animals be kept in zoos?" },
        { key: "C", q: "How does tourism affect the environment?" }
      ]
    },
    {
      id: "b17", cat: "culture_tradition",
      topic: "Globalisation and China", topicZh: "全球化与中国",
      cards: [
        { key: "A", point: "Economic integration and trade", pointZh: "经济融合与贸易" },
        { key: "B", point: "Scientific and technological cooperation", pointZh: "科技合作" },
        { key: "C", point: "Cultural exchange and mutual learning", pointZh: "文化交流互鉴" }
      ],
      discussion: "Does globalisation threaten national identity?",
      discussionZh: "全球化是否会威胁民族文化认同？",
      followUps: [
        { key: "A", q: "In what ways has globalisation changed China?" },
        { key: "B", q: "Will celebrating Western festivals hurt Chinese traditional culture?" },
        { key: "C", q: "How can Chinese students tell China's stories well to the world?" }
      ]
    },
    {
      id: "b18", cat: "career_growth",
      topic: "Part-time jobs for university students", topicZh: "大学生兼职",
      cards: [
        { key: "A", point: "Income and a sense of independence", pointZh: "收入与独立感" },
        { key: "B", point: "The conflict between work and study", pointZh: "工作与学业的冲突" },
        { key: "C", point: "Workplace skills learned early", pointZh: "提前习得职场技能" }
      ],
      discussion: "Should university students be encouraged to take part-time jobs?",
      discussionZh: "是否应鼓励大学生做兼职？",
      followUps: [
        { key: "A", q: "Is it important for college students to learn to manage a budget?" },
        { key: "B", q: "What part-time job would you like to try, and why?" },
        { key: "C", q: "What can a part-time job teach that a classroom cannot?" }
      ]
    },
    {
      id: "b19", cat: "career_growth",
      topic: "Failure and success", topicZh: "挫折与成功",
      cards: [
        { key: "A", point: "Failure builds resilience", pointZh: "挫折培养韧性" },
        { key: "B", point: "Failure gives honest feedback", pointZh: "挫折提供真实反馈" },
        { key: "C", point: "Failure clarifies what you really want", pointZh: "挫折让你看清所求" }
      ],
      discussion: "Is failure really the best teacher?",
      discussionZh: "失败真的是最好的老师吗？",
      followUps: [
        { key: "A", q: "Describe a lesson you learned from a particular event." },
        { key: "B", q: "Do you think people should always try to be the best?" },
        { key: "C", q: "What are three essential things needed to achieve success?" }
      ]
    },
    {
      id: "b20", cat: "study_campus",
      topic: "What should universities teach besides knowledge", topicZh: "大学除知识外还应教什么",
      cards: [
        { key: "A", point: "Critical thinking", pointZh: "批判性思维" },
        { key: "B", point: "Teamwork and communication", pointZh: "协作与沟通" },
        { key: "C", point: "Social responsibility", pointZh: "社会责任感" }
      ],
      discussion: "Should universities focus more on academic study or on preparing students for work?",
      discussionZh: "大学应更偏学术研究还是更偏就业准备？",
      followUps: [
        { key: "A", q: "Should higher education in China be less academic and more job-oriented?" },
        { key: "B", q: "Should students choose a major based on personal interest or future opportunity?" },
        { key: "C", q: "What do you think is the top priority of students at RUC, and why?" }
      ]
    },
    {
      id: "b21", cat: "life_relationship",
      topic: "The qualities of a good friend", topicZh: "好朋友的品质",
      cards: [
        { key: "A", point: "Honesty and trustworthiness", pointZh: "诚实可靠" },
        { key: "B", point: "Empathy and willingness to listen", pointZh: "共情与愿意倾听" },
        { key: "C", point: "Shared interests and humour", pointZh: "共同兴趣与幽默感" }
      ],
      discussion: "Is it better to have many friends or a few close ones?",
      discussionZh: "朋友多多好，还是知己寥寥更妙？",
      followUps: [
        { key: "A", q: "Why is it important to have friends?" },
        { key: "B", q: "What do you think contributes to a lasting friendship?" },
        { key: "C", q: "Is a sense of humour important in a friendship? Why?" }
      ]
    },
    {
      id: "b22", cat: "society_tech",
      topic: "The ageing society", topicZh: "老龄化社会",
      cards: [
        { key: "A", point: "Pressure on healthcare and pensions", pointZh: "医疗与养老保障压力" },
        { key: "B", point: "A shrinking labour force", pointZh: "劳动力减少" },
        { key: "C", point: "Wisdom and experience older people still offer", pointZh: "长者仍能提供经验与智慧" }
      ],
      discussion: "Is an ageing population a problem or an opportunity for China?",
      discussionZh: "人口老龄化对中国是问题还是机会？",
      followUps: [
        { key: "A", q: "What can young people do to help the elderly in daily life?" },
        { key: "B", q: "Should the retirement age be extended? Why or why not?" },
        { key: "C", q: "Do you think technology can solve the problems of an ageing society?" }
      ]
    }
  ]
};
