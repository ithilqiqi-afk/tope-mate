import {calculatePracticeScore} from './practice-score.mjs';

// Synthetic values solely to demonstrate backend arithmetic. This is NOT an AI assessment.
const request={
  examType:'C',stage:'speech',
  question:'Should universities encourage students to do volunteer work?',
  transcript:'Synthetic demonstration transcript; no real student assessment is performed.',
  durationSeconds:176,targetDurationSeconds:180
};
const syntheticDimensionScores={relevance:82,organization:76,development:78,language:74,taskCompletion:85};
const calculated=calculatePracticeScore(request,syntheticDimensionScores,{modelId:'synthetic-demo-only'});
console.log(JSON.stringify({
  demoOnly:true,
  notice:'以下维度分数为人为设置的合成数据，只演示后端加权计算，不是模型评分、学生成绩或官方成绩。',
  request:{examType:request.examType,stage:request.stage,durationSeconds:request.durationSeconds,targetDurationSeconds:request.targetDurationSeconds},
  syntheticDimensionScores,
  result:calculated
},null,2));
