import {validateRequest,blankResult} from './contract.mjs';
import {analyzeText,peelFromSignals} from './diagnostics.mjs';
const PEEL_ELIGIBLE = req => (req.examType==='C'&&req.stage==='speech')||(req.examType==='B'&&req.stage==='statement');
/** Mock: stable shape, NO SCORES, NO fabricated assessment. */
export function scoreMock(request){
  validateRequest(request);
  const out=blankResult(request,'mock');
  if(request.transcript.trim()) out.suggestions=['演示模式：这是固定的占位反馈，未对回答内容评分。'];
  return out;
}
/** Offline text signal hints: NOT QUALITY SCORES; supports high/medium/low fixture comparisons. */
export function scoreHeuristic(request){
  validateRequest(request);
  const out=blankResult(request,'heuristic');
  if(!request.transcript.trim())return out;
  const diag=analyzeText(request.transcript,request.durationSeconds,request.targetDurationSeconds);
  out.diagnostics={wordCount:diag.wordCount,detectedSignals:diag.detectedSignals,timingNote:diag.timingNote};
  const eligible=PEEL_ELIGIBLE(request);
  const {peel,peelDetails}=peelFromSignals(diag,eligible);
  out.peel=peel;out.peelDetails=peelDetails;
  if(eligible){
    for(const [key,label] of [['point','明确观点'],['explain','解释理由'],['example','具体例子'],['link','回扣主题']]){
      if(diag.detectedSignals[key]){
        out.strengths.push(`检测到“${label}”相关表达标记，但尚未核实逻辑质量。`);
        out.evidence.push({quote:diag.signalQuotes[key],observation:`可能涉及${label}，需进一步人工或 AI 判断。`,dimension:key==='point'?'organization':'development'});
      } else {
        out.suggestions.push(`尝试补充“${label}”的信息（目前没有发现典型提示词；若已有自然表达则无需套用模板）。`);
      }
    }
  }else{
    out.suggestions.push('本阶段不强制采用 PEEL，请针对题目直接回答并给出相关说明。');
  }
  if(diag.wordCount<35 && (request.stage==='speech'||request.stage==='statement')) out.weaknesses.push('文本较短，可尝试补充一个具体且切题的例子。');
  out.nextPractice=['用自己的话提出一个观点，并围绕真实或明确标注为假设的例子说明其意义。'];
  return out;
}
// Historical v0.2 compatibility: sync scoreResponse returns safe mock unless mode chosen.
export function scoreResponse(request,{mode='mock'}={}){
  if(mode==='mock')return scoreMock(request);
  if(mode==='heuristic')return scoreHeuristic(request);
  throw new RangeError('Sync scoreResponse supports mock or heuristic; use scoreWithOpenAI for ai.');
}
