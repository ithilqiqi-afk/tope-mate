#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {scoreResponse} from './scorer.mjs';
import {scoreWithOpenAI} from './provider.mjs';
const args=process.argv.slice(2);
const modeIndex=args.indexOf('--mode');
const mode=modeIndex>=0?args[modeIndex+1]:'heuristic';
const file=args.find((s,i)=>i!==modeIndex && i!==modeIndex+1 && !s.startsWith('--'));
if(!file || !['mock','heuristic','ai'].includes(mode)){
  console.error('Usage: node src/cli.mjs [--mode mock|heuristic|ai] fixtures/c_high.json');
  process.exit(2);
}
try {
  const req=JSON.parse(readFileSync(file,'utf8'));
  const report=mode==='ai'?await scoreWithOpenAI(req):scoreResponse(req,{mode});
  console.log(JSON.stringify(report,null,2));
  if(report.errors.length)process.exitCode=1;
}catch(err){
  console.error(`INVALID_REQUEST: ${err.message}`);process.exitCode=2;
}
