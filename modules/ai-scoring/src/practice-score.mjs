/** Shared interaction-evidence rule: the assessed candidate AND another real candidate
 *  (never the examiner) must both have non-empty turns in a B discussion. */
export function hasInteractionEvidence(request){
  return request.examType==='B' && request.stage==='discussion' &&
    Array.isArray(request.speakerTurns) && !!request.assessedSpeaker &&
    request.speakerTurns.some(x=>x.speaker===request.assessedSpeaker && x.text?.trim()) &&
    request.speakerTurns.some(x=>x.speaker!==request.assessedSpeaker && x.speaker!=='examiner' && x.text?.trim());
}

export const SCORE_VERSION = 'practice_index_v1.0.0';
export const PROMPT_VERSION = 'tope_practice_prompt_v0.6.0';
export const PRACTICE_SCORE_LABEL = 'TOPE Mate Practice Score';
export const SCORE_DISCLAIMER = '0–100 分为 TOPE Mate 产品内部练习参考分，依据可观察表现生成，用于同类练习的趋势比较；不是人大官方成绩、官方等级换算或正式考试预测。不同题目难度可能不同。';

// Product-defined weights. These are NOT Renmin University official weights.
// Each stage's configured weights sum to 100 before evidence-based exclusions.
export const STAGE_SCORE_CONFIG = Object.freeze({
  B: Object.freeze({
    self_intro: Object.freeze({
      weights: Object.freeze({relevance:25, organization:15, language:20, taskCompletion:25, timeManagement:15}),
      descriptions: Object.freeze({
        relevance:'自我介绍是否回应任务、内容相关且信息清楚。',
        organization:'信息安排是否有基本顺序，表达是否容易跟随。',
        language:'仅依据转写评价词汇选择、语法准确性和表达自然度。',
        taskCompletion:'是否完成自我介绍任务，是否覆盖有意义的个人信息。',
        timeManagement:'依据实际录音时长与明确设置的目标时长计算。'
      })
    }),
    statement: Object.freeze({
      weights: Object.freeze({relevance:25, organization:10, development:10, language:20, taskCompletion:25, timeManagement:10}),
      descriptions: Object.freeze({
        relevance:'是否紧扣任务卡主题，观点是否明确且切题。',
        organization:'陈述是否有清楚的组织顺序和连贯衔接。',
        development:'观点是否得到解释、理由和相关例子的支持；PEEL 仅作辅助诊断。',
        language:'仅依据转写评价词汇使用、语法准确性和表达自然度。',
        taskCompletion:'是否回应任务卡要求并完成个人陈述任务。',
        timeManagement:'依据实际录音时长与明确设置的目标时长计算。'
      })
    }),
    discussion: Object.freeze({
      weights: Object.freeze({relevance:25, development:15, language:20, interaction:25, taskCompletion:15}),
      descriptions: Object.freeze({
        relevance:'发言是否围绕共同讨论主题，并提出清楚相关的观点。',
        development:'是否解释观点、补充理由或例子，而非只作简短表态。',
        language:'仅依据转写评价词汇使用、语法准确性和表达自然度。',
        interaction:'是否回应他人、衔接观点、提出问题或推进讨论；必须有带说话人标签的真实轮次。',
        taskCompletion:'是否完成讨论任务并对共同讨论作出有效贡献。'
      })
    })
  }),
  C: Object.freeze({
    speech: Object.freeze({
      weights: Object.freeze({relevance:30, organization:15, development:10, language:25, taskCompletion:10, timeManagement:10}),
      descriptions: Object.freeze({
        relevance:'演讲是否切题，中心观点是否清楚并回应题目。',
        organization:'演讲结构、观点顺序和逻辑衔接是否清晰。',
        development:'论点是否得到解释、理由和具体例子的支持；PEEL 仅作辅助诊断。',
        language:'仅依据转写评价词汇丰富度、词汇准确性、语法准确性和句式使用；不评价发音语调。',
        taskCompletion:'是否完成题目要求的即兴演讲内容。',
        timeManagement:'依据实际录音时长与明确设置的目标时长计算。'
      })
    }),
    qa: Object.freeze({
      weights: Object.freeze({relevance:30, development:25, language:25, taskCompletion:20}),
      descriptions: Object.freeze({
        relevance:'是否直接回应考官提出的问题，回答是否切题。',
        development:'是否提供必要解释、理由或例子，使回答充分。',
        language:'仅依据转写评价词汇使用、语法准确性和表达自然度。',
        taskCompletion:'是否完成当前问答任务；不要求完整演讲结构或 PEEL。'
      })
    })
  })
});

export const SCORE_ANCHORS = Object.freeze([
  {range:'90–100',label:'非常突出',description:'在该维度上持续表现出色，证据充分，几乎没有明显缺口。'},
  {range:'80–89',label:'较强',description:'表现扎实，主要要求均能做到，仅有少量不足。'},
  {range:'70–79',label:'良好',description:'整体有效、清楚，仍有一些可识别的改进空间。'},
  {range:'60–69',label:'基本达到',description:'完成了主要要求，但表现不够稳定或存在明显缺口。'},
  {range:'50–59',label:'有限',description:'只部分满足要求，论述、表达或任务完成存在较明显不足。'},
  {range:'35–49',label:'较弱',description:'多项关键要求完成不足，证据较少或偏离任务。'},
  {range:'0–34',label:'很有限',description:'几乎没有展示该维度要求，或回答严重偏题/无法支持判断。'}
]);

const round = n => Math.round(n);
const sum = xs => xs.reduce((a,b)=>a+b,0);

export function getPracticeScoreConfig(request, {interactionAvailable=hasInteractionEvidence(request),modelId='unconfigured'}={}) {
  const stage = STAGE_SCORE_CONFIG[request.examType]?.[request.stage];
  if (!stage) throw new RangeError(`No practice score config for ${request.examType}:${request.stage}`);
  const configured = stage.weights;
  const assessedDimensions = Object.keys(configured).filter(key => {
    if (!request.transcript?.trim()) return false;
    if (key === 'interaction' && !interactionAvailable) return false;
    if (key === 'timeManagement' && !Number.isFinite(request.targetDurationSeconds)) return false;
    return true;
  });
  const notAssessedDimensions = Object.keys(configured).filter(key=>!assessedDimensions.includes(key));
  const configuredWeight = sum(Object.values(configured));
  const assessedWeight = sum(assessedDimensions.map(key=>configured[key]));
  const coveragePercent = configuredWeight ? round(assessedWeight/configuredWeight*100) : 0;
  const stableModelId = (typeof modelId==='string' && modelId.trim()) ? modelId.trim() : 'unconfigured';
  const comparisonKey = [SCORE_VERSION,PROMPT_VERSION,stableModelId,request.examType,request.stage,
    assessedDimensions.slice().sort().join(','),
    assessedDimensions.includes('timeManagement') ? `target-${request.targetDurationSeconds}s` : 'no-time-target'
  ].join('|');
  return {
    version:SCORE_VERSION,
    promptVersion:PROMPT_VERSION,
    modelId:stableModelId,
    label:PRACTICE_SCORE_LABEL,
    scaleMin:0,
    scaleMax:100,
    weightBasis:'product_defined_not_official',
    method:'weighted_average_of_assessed_dimensions_with_renormalization',
    configuredWeights:{...configured},
    descriptions:{...stage.descriptions},
    assessedDimensions,
    notAssessedDimensions,
    configuredWeight,
    assessedWeight,
    coveragePercent,
    comparisonKey,
    comparisonNote:'仅建议比较 scoreVersion、promptVersion、modelId、examType、stage、已评估维度和适用目标时长一致的练习。即使条件一致，不同题目的主题熟悉度与难度仍可能不同，分数只用于趋势参考。'
  };
}

/** A deterministic, explicitly product-defined timing indicator; not an official timing conversion. */
export function calculateTimingScore(durationSeconds, targetDurationSeconds) {
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(targetDurationSeconds) || targetDurationSeconds<=0) return null;
  const deviation = Math.abs(durationSeconds/targetDurationSeconds - 1);
  const epsilon = 1e-9;
  if (deviation <= 0.10 + epsilon) return 100;
  if (deviation <= 0.20 + epsilon) return 90;
  if (deviation <= 0.30 + epsilon) return 80;
  if (deviation <= 0.40 + epsilon) return 65;
  if (deviation <= 0.50 + epsilon) return 50;
  return 35;
}

export function calculatePracticeScore(request, modelScores, {interactionAvailable=hasInteractionEvidence(request),modelId='unconfigured'}={}) {
  const config = getPracticeScoreConfig(request,{interactionAvailable,modelId});
  const scores = {...modelScores};
  if (config.assessedDimensions.includes('timeManagement')) {
    scores.timeManagement = calculateTimingScore(request.durationSeconds,request.targetDurationSeconds);
  } else {
    scores.timeManagement = null;
  }
  if (!config.assessedDimensions.includes('interaction')) scores.interaction = null;
  const included = config.assessedDimensions.filter(key=>Number.isInteger(scores[key])&&scores[key]>=0&&scores[key]<=100);
  const assessedWeight = sum(included.map(key=>config.configuredWeights[key]));
  const numerator = sum(included.map(key=>scores[key]*config.configuredWeights[key]));
  const practiceScore = assessedWeight ? round(numerator/assessedWeight) : null;
  const coveragePercent = config.configuredWeight ? round(assessedWeight/config.configuredWeight*100) : 0;
  const missing = [...new Set([...config.notAssessedDimensions,...config.assessedDimensions.filter(key=>!included.includes(key))])];
  const status = practiceScore===null ? 'not_scored' : (coveragePercent===100 ? 'complete' : 'partial');
  const comparisonKey = [SCORE_VERSION,PROMPT_VERSION,config.modelId,request.examType,request.stage,
    included.slice().sort().join(','),
    included.includes('timeManagement') ? `target-${request.targetDurationSeconds}s` : 'no-time-target'
  ].join('|');
  return {
    practiceScore,
    scoreStatus:status,
    scores:Object.fromEntries(['relevance','organization','development','language','interaction','taskCompletion','timeManagement'].map(key=>[key,included.includes(key)?scores[key]:null])),
    scorePolicy:{
      version:SCORE_VERSION,promptVersion:PROMPT_VERSION,modelId:config.modelId,label:PRACTICE_SCORE_LABEL,scope:'stage',scaleMin:0,scaleMax:100,
      weightBasis:'product_defined_not_official',
      method:'weighted_average_of_assessed_dimensions_with_renormalization',
      configuredWeights:{...config.configuredWeights},
      disclaimer:SCORE_DISCLAIMER,
      timingRule:config.assessedDimensions.includes('timeManagement')?'Timing score is calculated by a fixed product rule from recorded duration and target duration; it is not an official conversion.':null
    },
    scoreCoverage:{
      configuredWeight:config.configuredWeight,
      assessedWeight,
      coveragePercent,
      assessedDimensions:included,
      notAssessedDimensions:missing,
      comparisonKey,
      comparisonNote:config.comparisonNote
    }
  };
}
