// Strict model schema. Aggregate practiceScore and product weights are backend-only.
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str = {type:'string'};
const nullableString = {anyOf:[{type:'string'},{type:'null'}]};
const score = {anyOf:[{type:'integer',minimum:0,maximum:100},{type:'null'}]};
const strings = {type:'array',items:str};
const evidence = object({quote:str,observation:str,dimension:str});
const expression = object({original:str,suggested:str,reason:str});
const errorItem = object({code:str,message:str});
const peelDetails = object({quote:nullableString,note:str});
const peelStatus = {type:'string',enum:['present','partial','absent','not_assessed']};
const dimensionFeedback = object({dimension:str,rationale:str,evidenceQuotes:strings});
export const AI_SCHEMA = object({
  schemaVersion:str,mode:{type:'string',enum:['ai']},examType:{type:'string',enum:['B','C']},stage:{type:'string',enum:['self_intro','statement','discussion','speech','qa']},
  // These are placeholders. Server calculates practiceScore and overall.score.
  practiceScore:{type:'null'},scoreVersion:str,scoreStatus:{type:'string',enum:['pending']},scorePolicy:{type:'null'},scoreCoverage:{type:'null'},
  overall:object({score:{type:'null'},maxScore:{type:'integer'},label:{type:'string',enum:['not_scored']},disclaimer:str}),
  rubricBasis:object({version:str,framework:str,area:str,dimensions:strings,assessmentMethod:str,verificationStatus:str,sourceUrl:str}),
  officialAssessment:object({scaleMin:{type:'integer'},scaleMax:{type:'integer'},level:{type:'null'},status:str,source:str,note:str}),
  scores:object({relevance:score,organization:score,development:score,language:score,interaction:score,taskCompletion:score,timeManagement:{type:'null'}}),
  dimensionFeedback:{type:'array',items:dimensionFeedback},
  strengths:strings,weaknesses:strings,suggestions:strings,
  evidence:{type:'array',items:evidence},
  peel:object({point:peelStatus,explain:peelStatus,example:peelStatus,link:peelStatus}),
  peelDetails:object({point:peelDetails,explain:peelDetails,example:peelDetails,link:peelDetails}),
  improvedExpressions:{type:'array',items:expression},nextPractice:strings,
  diagnostics:object({wordCount:{type:'integer'},detectedSignals:object({point:{type:'boolean'},explain:{type:'boolean'},example:{type:'boolean'},link:{type:'boolean'}}),timingNote:str}),
  unassessed:strings, errors:{type:'array',items:errorItem}
});
