/** Official RUC-TOPE descriptors remain qualitative anchors; product practice scores are separate. */
export const PRACTICE_RUBRIC_VERSION = 'ruc_tope_official_bands_v1';
export const STAGES = Object.freeze({
  B:Object.freeze(['self_intro','statement','discussion']),
  C:Object.freeze(['speech','qa'])
});
export const DIMENSIONS = Object.freeze(['relevance','organization','development','language','interaction','taskCompletion','timeManagement']);
export const OFFICIAL_REFERENCE = Object.freeze({
  objectives:'https://sope.ruc.edu.cn/index/page-269.html',
  levels:'https://sope.ruc.edu.cn/index/page-270.html',
  testDescription:'https://sope.ruc.edu.cn/index/page-296.html',
  scoringStandards:'https://sope.ruc.edu.cn/index/page-297.html'
});
export const AREAS = Object.freeze({
  B:Object.freeze({name:'陈述与讨论', dimensions:Object.freeze(['话题内容','讨论参与及语用适切','交际任务完成'])}),
  C:Object.freeze({name:'演讲与问答', dimensions:Object.freeze(['话题内容与论述','词汇语法及语音语调','时间控制'])})
});
export const RUBRICS = Object.freeze({
  'B:self_intro':{focus:'自我介绍：关注是否回应简短介绍任务、信息是否相关清楚、组织是否易于跟随，以及是否完成任务。不要强制 PEEL。'},
  'B:statement':{focus:'个人陈述：回应任务卡，观点明确、内容充实、语言连贯、叙述合理、结构完整。PEEL 仅作辅助诊断，不是官方独立评分维度。'},
  'B:discussion':{focus:'小组讨论：围绕共同主题表达观点、解释理由、回应他人并恰当运用交际策略。互动评分必须有真实且带说话人标签的轮次。'},
  'C:speech':{focus:'即兴演讲：紧扣主题、观点明确、论述合理、逻辑清晰、词汇语法得体，并在有可靠目标时长时检查时间控制。PEEL 仅用于论证展开辅导。'},
  'C:qa':{focus:'考官问答：围绕考官问题直接回应，内容充分、解释合理、语言清楚；不要求完整演讲结构或 PEEL。'}
});
export function rubricFor(req){return RUBRICS[`${req.examType}:${req.stage}`];}
export function officialBasisFor(req){
  const area=AREAS[req.examType];
  return {
    version:PRACTICE_RUBRIC_VERSION,
    framework:'中国人民大学英语口语能力标准（RUC-SOPE）及RUC-TOPE公开测试说明',
    area:area.name,
    dimensions:[...area.dimensions],
    assessmentMethod:'用户提供的官方评分表采用 1–6 级能力描述；截图未提供可直接复用的百分制权重。TOPE Mate 0–100 练习参考分是独立产品指标，不是官方权重或官方等级换算。',
    verificationStatus:'已逐级核对用户上传的 B/C 官方评分表截图（1–6级）。C 表格虽题为“演讲与问答”，逐级条目列出的观察内容为演讲内容、词汇语法及语音语调、时间控制；不据此虚构单独的 Q&A 官方权重。',
    sourceUrl:OFFICIAL_REFERENCE.scoringStandards
  };
}
export const DISCLAIMER='TOPE Mate 练习参考分（0–100）是产品内部的练习表现指标，用于同类练习的趋势比较；不是人大官方成绩、官方等级换算或正式考试预测。转写文本不能评价发音和语调；缺少带说话人标签的讨论轮次时不能评价真实互动。';
