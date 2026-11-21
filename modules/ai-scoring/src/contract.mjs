import {STAGES,DIMENSIONS,DISCLAIMER,officialBasisFor} from './rubrics.mjs';
import {getPracticeScoreConfig,SCORE_VERSION,PROMPT_VERSION,SCORE_DISCLAIMER} from './practice-score.mjs';
export const SCHEMA_VERSION = '1.4.0';
const isObj = v => v!==null && typeof v==='object' && !Array.isArray(v);
export function validateRequest(request) {
  if (!isObj(request)) throw new TypeError('Request must be an object');
  if (!STAGES[request.examType] || !STAGES[request.examType].includes(request.stage))
    throw new RangeError('Unsupported examType/stage combination');
  if (typeof request.question!=='string' || !request.question.trim() || request.question.length>3000)
    throw new TypeError('question must be a non-empty string of at most 3000 chars');
  if (typeof request.transcript!=='string' || request.transcript.length>30000)
    throw new TypeError('transcript must be a string of at most 30000 chars');
  if (typeof request.durationSeconds!=='number' || !Number.isFinite(request.durationSeconds) || request.durationSeconds<0 || request.durationSeconds>3600)
    throw new RangeError('durationSeconds must be between 0 and 3600');
  if (request.targetDurationSeconds!==undefined && (!Number.isFinite(request.targetDurationSeconds) || request.targetDurationSeconds<=0 || request.targetDurationSeconds>3600))
    throw new RangeError('targetDurationSeconds must be positive and <=3600');
  if (request.rubric!==null && request.rubric!==undefined && !(typeof request.rubric==='string' && request.rubric.length<=200))
    throw new TypeError('rubric must be a short version label or null');
  if (request.assessedSpeaker!==undefined && !['A','B','C'].includes(request.assessedSpeaker))
    throw new TypeError('assessedSpeaker must be A, B or C');
  if (request.speakerTurns!==undefined) {
    if (!Array.isArray(request.speakerTurns) || request.speakerTurns.length>150 || request.speakerTurns.some(t=> !isObj(t)||!['A','B','C','examiner'].includes(t.speaker)||typeof t.text!=='string'||t.text.length>3000))
      throw new TypeError('speakerTurns must be speaker/text objects (<=150 turns)');
  }
  return true;
}
export function hasInteractionEvidence(request){
  return request.examType==='B' && request.stage==='discussion' &&
    Array.isArray(request.speakerTurns) && request.speakerTurns.some(x=>x.speaker===request.assessedSpeaker) &&
    request.speakerTurns.some(x=>x.speaker!==request.assessedSpeaker) && !!request.assessedSpeaker;
}
function initialScoreMeta(request){
  const cfg=getPracticeScoreConfig(request);
  return {
    practiceScore:null,
    scoreVersion:SCORE_VERSION,
    scoreStatus:'not_scored',
    scorePolicy:{
      version:SCORE_VERSION,promptVersion:PROMPT_VERSION,modelId:'unconfigured',label:'TOPE Mate Practice Score',scope:'stage',scaleMin:0,scaleMax:100,
      weightBasis:'product_defined_not_official',method:'weighted_average_of_assessed_dimensions_with_renormalization',
      configuredWeights:{...cfg.configuredWeights},disclaimer:SCORE_DISCLAIMER,timingRule:null
    },
    scoreCoverage:{configuredWeight:cfg.configuredWeight,assessedWeight:0,coveragePercent:0,assessedDimensions:[],notAssessedDimensions:[...new Set([...cfg.notAssessedDimensions,...cfg.assessedDimensions])],comparisonKey:cfg.comparisonKey,comparisonNote:cfg.comparisonNote}
  };
}
export function blankResult(request, mode='mock'){
  const empty=!request.transcript.trim();
  const scoreMeta=initialScoreMeta(request);
  return {schemaVersion:SCHEMA_VERSION, mode, examType:request.examType, stage:request.stage,
    practiceScore:null,scoreVersion:SCORE_VERSION,scoreStatus:'not_scored',scorePolicy:scoreMeta.scorePolicy,scoreCoverage:scoreMeta.scoreCoverage,
    overall:{score:null,maxScore:100,label:empty?'insufficient_evidence':'not_scored',disclaimer:DISCLAIMER},
    rubricBasis:officialBasisFor(request),
    officialAssessment:{scaleMin:1,scaleMax:6,level:null,status:'not_predicted',source:'ruc_tope_official_bands_v1',note:'官方 1–6 级描述仅作为定性评价锚点；TOPE Mate 不输出官方等级预测。'},
    scores:Object.fromEntries(DIMENSIONS.map(k=>[k,null])),dimensionFeedback:[],
    strengths:[],weaknesses:[],suggestions:[],evidence:[],
    peel:{point:'not_assessed',explain:'not_assessed',example:'not_assessed',link:'not_assessed'},
    peelDetails:{point:{quote:null,note:''},explain:{quote:null,note:''},example:{quote:null,note:''},link:{quote:null,note:''}},
    improvedExpressions:[],nextPractice:[],
    diagnostics:{wordCount:0,detectedSignals:{point:false,explain:false,example:false,link:false},timingNote:''},
    unassessed:['pronunciation','prosody','audio_fluency',...scoreMeta.scoreCoverage.notAssessedDimensions,...((request.examType==='B'&&request.stage==='discussion'&&!hasInteractionEvidence(request))?['group_interaction_without_speaker_turns']:[])],
    errors:empty?[{code:'EMPTY_TRANSCRIPT',message:'No transcript was provided; ask for a new recording or edited text.'}]:[]};
}
export function validateResponse(result, request, {requireAi=false}={}){
  if (!isObj(result)) throw new Error('AI response must be a JSON object');
  if (requireAi && result.mode!=='ai') throw new Error('Response mode must be ai');
  if (result.examType!==request.examType || result.stage!==request.stage) throw new Error('Response stage mismatch');
  if (!isObj(result.rubricBasis) || !Array.isArray(result.rubricBasis.dimensions)) throw new Error('Missing official rubric basis');
  if (!isObj(result.officialAssessment) || result.officialAssessment.level!==null || result.officialAssessment.scaleMin!==1 || result.officialAssessment.scaleMax!==6)
    throw new Error('Must not report an official level from practice assessment');
  if (!isObj(result.scores) || !isObj(result.peel) || !isObj(result.peelDetails)) throw new Error('Missing scores/PEEL');
  for (const dim of DIMENSIONS) {
    const v=result.scores[dim];
    if (!(v===null || (Number.isInteger(v)&&v>=0&&v<=100))) throw new Error(`Invalid score: ${dim}`);
  }
  for (const field of ['strengths','weaknesses','suggestions','evidence','improvedExpressions','nextPractice','unassessed','errors','dimensionFeedback'])
    if (!Array.isArray(result[field])) throw new Error(`Missing array: ${field}`);
  for (const field of ['strengths','weaknesses','suggestions','nextPractice','unassessed'])
    if (result[field].some(s=>typeof s!=='string')) throw new Error(`Invalid ${field}`);
  const config=getPracticeScoreConfig(request);
  const allowed=new Set(config.assessedDimensions);
  const allowedQuoteSources=[request.transcript,...(Array.isArray(request.speakerTurns)?request.speakerTurns.map(t=>t.text):[])];
  const seen=new Set();
  for (const item of result.dimensionFeedback){
    if (!isObj(item)||!allowed.has(item.dimension)||seen.has(item.dimension)||typeof item.rationale!=='string'||!Array.isArray(item.evidenceQuotes))
      throw new Error('Invalid dimension feedback item');
    if (item.evidenceQuotes.some(q=>typeof q!=='string'||!q||!allowedQuoteSources.some(source=>source.includes(q)))) throw new Error('Dimension feedback quote must be verbatim');
    seen.add(item.dimension);
  }
  for (const k of ['point','explain','example','link']){
    if (!['present','partial','absent','not_assessed'].includes(result.peel[k])) throw new Error(`Invalid PEEL status: ${k}`);
    const entry=result.peelDetails[k];
    if (!isObj(entry)||!(entry.quote===null||typeof entry.quote==='string')||typeof entry.note!=='string') throw new Error(`Invalid PEEL detail: ${k}`);
    if (entry.quote && !request.transcript.includes(entry.quote)) throw new Error(`Invented PEEL quote: ${k}`);
  }
  for (const item of result.evidence){
    if (!isObj(item)||typeof item.quote!=='string'||!item.quote||!request.transcript.includes(item.quote)||typeof item.observation!=='string'||typeof item.dimension!=='string')
      throw new Error('Evidence must quote transcript verbatim');
  }
  for (const item of result.improvedExpressions){
    if (!isObj(item)||typeof item.original!=='string'||typeof item.suggested!=='string'||typeof item.reason!=='string'||(item.original&&!request.transcript.includes(item.original)))
      throw new Error('Improved expressions must quote transcript verbatim');
  }
  return true;
}
