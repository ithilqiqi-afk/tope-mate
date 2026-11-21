// Signals are text heuristics, NOT linguistic assessment or authentic PEEL classification.
const PATTERNS = {
  point:/\b(?:i (?:believe|think|argue|would (?:say|choose))|in my (?:view|opinion)|my (?:position|main point) is|i support|i disagree)\b/i,
  explain:/\b(?:because|since|one reason|this is (?:because|due to)|which means|as a result of|the reason is)\b/i,
  example:/\b(?:for example|for instance|such as|to illustrate|i once|last semester|imagine (?:this|a))\b/i,
  link:/\b(?:this (?:shows|demonstrates|illustrates)|therefore|in conclusion|to sum up|for these reasons|that is why)\b/i
};
const approxWords = text => (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[\u4e00-\u9fff]+/g)||[]).length;
function quoteAt(text,match){
  if (!match) return null;
  const at=match.index; let start=at,end=at+match[0].length;
  while(start>0 && start>at-110 && !/[.!?\n]/.test(text[start-1])) start--;
  while(end<text.length && end<at+135 && !/[.!?\n]/.test(text[end])) end++;
  return text.slice(start,end).trim().slice(0,240)||null;
}
export function analyzeText(transcript, durationSeconds, targetDurationSeconds){
  const wordCount=approxWords(transcript);
  const hits=Object.fromEntries(Object.entries(PATTERNS).map(([k,re])=>[k,re.exec(transcript)]));
  const detectedSignals=Object.fromEntries(Object.entries(hits).map(([k,v])=>[k,!!v]));
  const signalQuotes=Object.fromEntries(Object.entries(hits).map(([k,v])=>[k,quoteAt(transcript,v)]));
  let timingNote='没有可靠的逐字稿完整性信息；不自动给时间分。';
  if(Number.isFinite(targetDurationSeconds)) timingNote=`本次记录 ${durationSeconds} 秒；所设目标 ${targetDurationSeconds} 秒。仅供练习参考，不据此判断发音或内容质量。`;
  return {wordCount,detectedSignals,signalQuotes,timingNote};
}
export function peelFromSignals(diag,eligible){
  const peel={}; const peelDetails={};
  for(const k of ['point','explain','example','link']){
    peel[k]=eligible?(diag.detectedSignals[k]?'partial':'absent'):'not_assessed';
    peelDetails[k]={quote:eligible?diag.signalQuotes[k]:null,
      note:!eligible?'本考试阶段不强制使用 PEEL。':diag.detectedSignals[k]?'检测到可能相关的表达标记；需由 AI 判断是否真正有效。':'没有检测到常见表达标记；不代表语义上一定缺失。'};
  }
  return {peel,peelDetails};
}
