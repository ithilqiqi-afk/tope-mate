/**
 * 生成 docs/contracts/fixtures/ 下的评分合约样例。
 *
 * 这些 JSON 不是手写的理想样例，而是直接调用 B 的 modules/ai-scoring 生产函数
 * normalizeAIResult() 得到的真实输出，字段必然与该模块当前实现一致。
 * B 升级 Schema 后重新运行本脚本即可暴露漂移：
 *
 *   node tools/make-contract-fixtures.mjs
 *
 * 全程离线：不调用付费接口、不需要 API Key；文本为虚构练习内容，不代表真实考生表现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAIResult } from '../modules/ai-scoring/src/provider.mjs';
import { SCHEMA_VERSION } from '../modules/ai-scoring/src/contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/contracts/fixtures');
const MODEL_ID = 'gpt-4o-mini';

const C_SPEECH = {
  examType: 'C',
  stage: 'speech',
  question: 'Some people think universities should require students to do volunteer work, while others believe participation should be optional. Which view do you agree with, and why?',
  questionId: 'c-speech-001',
  transcript: 'I believe universities should encourage volunteer work, while keeping participation voluntary. First, volunteering helps students turn knowledge into practical skills, because they must explain ideas to people with different backgrounds. For example, last semester I helped younger students with reading at a community centre near my campus. That experience also showed me the limits of my own patience. In conclusion, I support volunteer opportunities that connect study with real life, as long as students can choose how much time to give.',
  durationSeconds: 176,
  targetDurationSeconds: 180,
  rubric: 'ruc_tope_official_bands_v1'
};

/* 不传 assessedSpeaker / speakerTurns：这正是要展示互动维度保持 null、
   而不是从单人独白里猜出互动分的场景。 */
const B_DISCUSSION = {
  examType: 'B',
  stage: 'discussion',
  question: 'Your group has five minutes to discuss whether universities should make community service a graduation requirement, and then reach one shared decision.',
  questionId: 'b-discussion-014',
  transcript: 'I am not sure a fixed requirement is the right tool, because some students already work part time to support their families. Perhaps the university could recognise voluntary service on the transcript instead of forcing everyone. That way we keep the incentive without punishing the students who have the least free time.',
  durationSeconds: 214,
  targetDurationSeconds: 300,
  rubric: 'ruc_tope_official_bands_v1'
};

const RUBRIC_BASIS = {
  version: 'ruc_tope_official_bands_v1',
  framework: '中国人民大学英语口语能力标准（RUC-SOPE）及RUC-TOPE公开测试说明',
  area: '演讲与问答',
  dimensions: ['话题内容与论述', '词汇语法及语音语调', '时间控制'],
  assessmentMethod: '官方评分表使用 1–6 级能力描述，产品 0–100 练习参考分是独立指标。',
  verificationStatus: '已逐级核对官方公开评分表条目。',
  sourceUrl: 'https://sope.ruc.edu.cn/index/page-297.html'
};

/**
 * 模型层输出：只有维度分与文本反馈，聚合练习分、官方等级、覆盖率都由服务端补齐。
 * 服务端会拒绝任何不是转写逐字片段的引用，所以所有 quote 都从 transcript 里取。
 */
function modelReport(request, patch) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    mode: 'ai',
    examType: request.examType,
    stage: request.stage,
    practiceScore: null,
    scoreVersion: 'practice_index_v1.0.0',
    scoreStatus: 'pending',
    scorePolicy: null,
    scoreCoverage: null,
    overall: { score: null, maxScore: 100, label: 'not_scored', disclaimer: '占位字段：聚合分由服务端计算。' },
    rubricBasis: RUBRIC_BASIS,
    officialAssessment: { scaleMin: 1, scaleMax: 6, level: null, status: 'not_predicted', source: 'ruc_tope_official_bands_v1', note: '官方 1–6 级描述仅作定性锚点；不预测官方等级。' },
    scores: { relevance: null, organization: null, development: null, language: null, interaction: null, taskCompletion: null, timeManagement: null },
    dimensionFeedback: [],
    strengths: [],
    weaknesses: [],
    suggestions: [],
    evidence: [],
    peel: { point: 'not_assessed', explain: 'not_assessed', example: 'not_assessed', link: 'not_assessed' },
    peelDetails: {
      point: { quote: null, note: '' },
      explain: { quote: null, note: '' },
      example: { quote: null, note: '' },
      link: { quote: null, note: '' }
    },
    improvedExpressions: [],
    nextPractice: [],
    diagnostics: { wordCount: 0, detectedSignals: { point: false, explain: false, example: false, link: false }, timingNote: '' },
    unassessed: [],
    errors: []
  };
  return { ...base, ...patch };
}

/** 逐字截取转写开头若干词作为引用，保证一定通过服务端引用核验。 */
function verbatim(transcript, from, words = 9) {
  const start = transcript.indexOf(from);
  if (start < 0) throw new Error(`样例引用不在转写里：${from}`);
  const slice = transcript.slice(start).split(' ').slice(0, words).join(' ');
  return slice.replace(/[.,;]$/, '');
}

function cQuoted(transcript) {
  return {
    stance: verbatim(transcript, 'I believe universities', 10),
    reason: verbatim(transcript, 'First, volunteering helps', 11),
    example: verbatim(transcript, 'For example, last semester', 12),
    reflection: verbatim(transcript, 'That experience also showed', 9),
    conclusion: verbatim(transcript, 'In conclusion, I support', 11)
  };
}

function bQuoted(transcript) {
  return {
    doubt: verbatim(transcript, 'I am not sure', 10),
    cost: verbatim(transcript, 'because some students', 11),
    alternative: verbatim(transcript, 'Perhaps the university', 11),
    effect: verbatim(transcript, 'That way we keep', 13)
  };
}

const cT = cQuoted(C_SPEECH.transcript);
const cReport = modelReport(C_SPEECH, {
  scores: { relevance: 82, organization: 76, development: 78, language: 80, interaction: null, taskCompletion: 84, timeManagement: null },
  dimensionFeedback: [
    { dimension: 'relevance', rationale: '第一句就给出立场并限定条件，全程围绕是否应当强制。', evidenceQuotes: [cT.stance] },
    { dimension: 'organization', rationale: '用 First / For example / In conclusion 推进，结尾回到立场。', evidenceQuotes: [cT.conclusion] },
    { dimension: 'development', rationale: '用社区阅读辅导的亲身经历支撑论点。', evidenceQuotes: [cT.example] },
    { dimension: 'language', rationale: '句式有变化，个别表达可更自然。', evidenceQuotes: [cT.reflection] },
    { dimension: 'taskCompletion', rationale: '立场加理由，完成了题目的说明任务。', evidenceQuotes: [cT.stance] }
  ],
  strengths: ['开头即明确立场，听者不需要猜测观点。', '能用可核查的自身经历支撑理由。'],
  weaknesses: ['只展开了一段经历，第二个理由缺少支撑。'],
  suggestions: ['为每个理由准备一个具体例子，长度保持均衡。'],
  evidence: [
    { quote: cT.stance, observation: '开门见山，切题。', dimension: 'relevance' },
    { quote: cT.example, observation: '经历具体，可被验证。', dimension: 'development' }
  ],
  peel: { point: 'present', explain: 'present', example: 'present', link: 'present' },
  peelDetails: {
    point: { quote: cT.stance, note: '提出了明确立场。' },
    explain: { quote: cT.reason, note: '解释了技能转化的机制。' },
    example: { quote: cT.example, note: '给出社区辅导的实例。' },
    link: { quote: cT.conclusion, note: '结论回扣主张。' }
  },
  improvedExpressions: [
    { original: 'That experience also showed me the limits of my own patience', suggested: 'That experience also taught me how much patience teaching really takes', reason: '把抽象的“limits”换成更具体的收获。' }
  ],
  nextPractice: ['练习在两个理由上各展开一个例子，使论证更均衡。']
});

const bT = bQuoted(B_DISCUSSION.transcript);
/* B 小组讨论的产品权重里没有 organization 和 timeManagement，互动权重 25 又因缺少
   真实轮次被排除，所以这份样例的覆盖率停在 75%、状态是 partial。 */
const bReport = modelReport(B_DISCUSSION, {
  scores: { relevance: 74, organization: null, development: 68, language: 72, interaction: null, taskCompletion: 58, timeManagement: null },
  dimensionFeedback: [
    { dimension: 'relevance', rationale: '针对是否强制服务提出保留意见，切题。', evidenceQuotes: [bT.doubt] },
    { dimension: 'development', rationale: '用兼职学生的处境支撑保留意见，但没有展开第二个理由。', evidenceQuotes: [bT.cost] },
    { dimension: 'language', rationale: '表达准确，句式略单一。', evidenceQuotes: [bT.effect] },
    { dimension: 'taskCompletion', rationale: '提出了替代方案，却没有收敛出小组共同决定。', evidenceQuotes: [bT.alternative] }
  ],
  suggestions: ['在讨论中明确邀请同伴发言并回应对方观点。'],
  evidence: [{ quote: bT.doubt, observation: '立场清楚，但没有向同伴发问或回应。', dimension: 'relevance' }],
  nextPractice: ['练习用一句话说出小组最终达成的共同决定。']
});

const outputs = [
  ['evaluation-request.sample.json', C_SPEECH],
  ['evaluation-request-b-discussion.sample.json', B_DISCUSSION],
  ['evaluation-response.sample.json', { success: true, data: normalizeAIResult(cReport, C_SPEECH, { modelId: MODEL_ID }), meta: { questionId: C_SPEECH.questionId, demoOnly: false } }],
  ['evaluation-response-partial.sample.json', { success: true, data: normalizeAIResult(bReport, B_DISCUSSION, { modelId: MODEL_ID }), meta: { questionId: B_DISCUSSION.questionId, demoOnly: false } }],
  ['evaluation-error.sample.json', { success: false, error: { code: 'API_KEY_MISSING', message: '服务器尚未配置 AI 评分所需的 API Key，请联系管理员或改用离线模式。', retryable: false } }]
];

for (const [name, payload] of outputs) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log('written: docs/contracts/fixtures/', name);
}

const complete = outputs[2][1].data;
const partial = outputs[3][1].data;
console.log(`complete: ${complete.practiceScore} / ${complete.scoreStatus} / coverage ${complete.scoreCoverage.coveragePercent}%`);
console.log(`partial : ${partial.practiceScore} / ${partial.scoreStatus} / coverage ${partial.scoreCoverage.coveragePercent}% / interaction ${partial.scores.interaction}`);
