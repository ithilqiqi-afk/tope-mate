/* 百炼转写通路在 HTTP 层的行为（离线模拟：伪造密钥、伪造录音、零真实调用）。
   验证外部接口 POST /api/transcribe 与 GET /health 未变，
   上传体积/时长/格式上限在出网前生效，两个供应商的密钥互不回退，
   且服务端日志与响应都不包含录音字节或转写文本。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createTranscriptionServer,resolveProvider,PROVIDERS,DEFAULT_MAX_BODY_BYTES} from '../src/http-server.mjs';
import {BAILIAN_MAX_RAW_BYTES,BAILIAN_ASR_MODEL} from '../src/bailian-provider.mjs';

const BEIJING_BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const BEIJING_URL=`${BEIJING_BASE}/chat/completions`;
const BAILIAN_KEY='FAKE_BAILIAN_KEY_offline_http_test';
const OPENAI_KEY='FAKE_OPENAI_KEY_that_must_stay_unused';
const AUDIO = Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]), Buffer.from('fake-opus-payload-for-offline-http-tests'.repeat(3))]);
const META = {examType:'C',stage:'speech',stageName:'个人陈述',sessionId:'s-7',questionId:'c-speech-001',language:'en',durationSeconds:96,mimeType:'audio/webm;codecs=opus'};

function formBody({meta=META,audio=AUDIO,audioType='audio/webm;codecs=opus',filename='rec.webm'}={}){
  const fd=new FormData();
  if(meta!==undefined) fd.append('meta',typeof meta==='string'?meta:JSON.stringify(meta));
  if(audio!==null) fd.append('audio',new Blob([audio],{type:audioType}),filename);
  return fd;
}
function spyFetch(response,{status=200}={}){
  const calls=[];
  const fn=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return {ok:status>=200&&status<300,status,json:async()=>response};};
  return {calls,fn};
}
const asrAnswer=text=>({model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'stop',message:{content:text}}]});

async function withServer(options,fn){
  const server=createTranscriptionServer({log:()=>{},...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const base=`http://127.0.0.1:${port}`;
  try{await fn(base,port);}finally{await new Promise(resolve=>server.close(resolve));}
}
/** 低层请求：自己声明 Content-Length，走服务端的预检分支。 */
function rawRequest(port,{path='/api/transcribe',headers={}},payload){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method:'POST',path,headers,agent:false},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(payload)req.write(payload);
    req.end();
  });
}
const upload=async(base,payload)=>{
  const res=await fetch(`${base}/api/transcribe`,{method:'POST',body:payload});
  const text=await res.text();
  return {status:res.status,text,body:safeJson(text)};
};
function safeJson(text){try{return JSON.parse(text);}catch{return null;}}

test('TRANSCRIBE_PROVIDER 只接受 openai 与 bailian',()=>{
  assert.deepEqual([...PROVIDERS],['openai','bailian']);
  assert.equal(resolveProvider(' BAILIAN '),'bailian');
  assert.equal(resolveProvider(undefined),'openai');
  assert.throws(()=>resolveProvider('zhipu'),/Unsupported TRANSCRIBE_PROVIDER/);
  assert.throws(()=>createTranscriptionServer({provider:'zhipu'}),/Unsupported TRANSCRIBE_PROVIDER/);
});

test('百炼通路的健康检查如实报告模型、格式白名单与折算后的上传上限',async()=>{
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE},async base=>{
    const res=await fetch(`${base}/health`);
    const text=await res.text();
    const body=JSON.parse(text);
    assert.equal(res.status,200);
    assert.equal(body.success,true);
    assert.equal(body.data.contract,'transcribe_v1');
    assert.equal(body.data.provider,'bailian');
    assert.equal(body.data.model,BAILIAN_ASR_MODEL);
    assert.equal(body.data.keyConfigured,true);
    assert.equal(body.data.maxAudioSeconds,300);
    assert.deepEqual(body.data.allowedFormats.sort(),['flac','mp3','ogg','wav','webm']);
    assert.equal(body.data.maxAudioBytes,BAILIAN_MAX_RAW_BYTES);
    assert.ok(BAILIAN_MAX_RAW_BYTES<DEFAULT_MAX_BODY_BYTES,'百炼通路必须收紧到 Base64 折算后的原始字节上限。');
    assert.ok(!text.includes(BAILIAN_KEY));
    assert.ok(!text.includes('llm-placeholder'));
  });
  await withServer({provider:'bailian',bailianBaseUrl:BEIJING_BASE,bailianApiKey:''},async base=>{
    const body=await (await fetch(`${base}/health`)).json();
    assert.equal(body.data.keyConfigured,false,'无 Key 时健康检查照常返回 200。');
  });
});

test('WebM/Opus 录音经百炼通路转写：200 信封、meta 原样回传、文本只来自模型',async()=>{
  const spy=spyFetch(asrAnswer('Good morning examiners. I would like to start with my preparation.'));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,200);
    assert.equal(r.body.success,true);
    assert.equal(r.body.data.transcript,'Good morning examiners. I would like to start with my preparation.');
    assert.equal(r.body.data.contract,'transcribe_v1');
    assert.equal(r.body.data.model,BAILIAN_ASR_MODEL);
    assert.equal(r.body.data.format,'webm');
    assert.equal(r.body.data.empty,false);
    assert.equal(r.body.data.bytesReceived,AUDIO.length);
    assert.deepEqual(r.body.meta,{sessionId:'s-7',stage:'speech',stageName:'个人陈述',questionId:'c-speech-001',demoOnly:false});
    assert.equal(spy.calls.length,1);
    assert.equal(spy.calls[0].url,BEIJING_URL);
    assert.equal(spy.calls[0].body.messages[0].content[0].type,'input_audio');
    assert.ok(spy.calls[0].body.messages[0].content[0].input_audio.data.startsWith('data:audio/webm;base64,'));
    assert.deepEqual(spy.calls[0].body.asr_options,{language:'en',enable_itn:false});
    assert.ok(!r.text.includes(BAILIAN_KEY));
  });
});

test('模型返回空文本时如实报告没有可用语音，不编造转写',async()=>{
  const spy=spyFetch(asrAnswer(''));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,200);
    assert.equal(r.body.data.transcript,'');
    assert.equal(r.body.data.empty,true);
  });
});

test('超过 5 分钟的录音在服务端被拒，且绝不发往百炼',async()=>{
  const spy=spyFetch(asrAnswer('should not be called'));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const r=await upload(base,formBody({meta:{...META,durationSeconds:301}}));
    assert.equal(r.status,413);
    assert.equal(r.body.error.code,'AUDIO_TOO_LONG');
    assert.match(r.body.error.message,/不会截断/);
    assert.equal(r.body.error.retryable,false);
    assert.equal(spy.calls.length,0);
    const edge=await upload(base,formBody({meta:{...META,durationSeconds:300}}));
    assert.equal(edge.status,200,'刚好 5 分钟仍允许。');
  });
});

test('Safari 的 M4A 录音走不通百炼 ASR：415 且不出网',async()=>{
  const spy=spyFetch(asrAnswer('should not be called'));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const r=await upload(base,formBody({audioType:'audio/mp4',filename:'rec.m4a'}));
    assert.equal(r.status,415);
    assert.equal(r.body.error.code,'UNSUPPORTED_FORMAT');
    assert.equal(spy.calls.length,0);
  });
});

test('超过上限的上传在读体阶段就被拒，且不转给百炼',async()=>{
  const spy=spyFetch(asrAnswer('should not be called'));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn,maxBodyBytes:4096},async (base,port)=>{
    const huge=Buffer.alloc(8192,0x61);
    const body=Buffer.concat([
      Buffer.from(`--TOPEbig\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(META)}\r\n--TOPEbig\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      huge,
      Buffer.from('\r\n--TOPEbig--\r\n')
    ]);
    const res=await rawRequest(port,{headers:{'Content-Type':'multipart/form-data; boundary=TOPEbig','Content-Length':String(body.length)}},body);
    assert.equal(res.status,413);
    assert.equal(JSON.parse(res.text).error.code,'PAYLOAD_TOO_LARGE');
    assert.equal(spy.calls.length,0);
  });
});

test('OpenAI 密钥不会被用于百炼：缺百炼 Key 直接 503 且不出网',async()=>{
  const spy=spyFetch(asrAnswer('should not be called'));
  await withServer({provider:'bailian',apiKey:OPENAI_KEY,bailianApiKey:'',bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,503);
    assert.equal(r.body.error.code,'API_KEY_MISSING');
    assert.equal(spy.calls.length,0);
    assert.ok(!r.text.includes(OPENAI_KEY));
  });
});

test('业务空间地址没填好时返回 503 PROVIDER_CONFIG_ERROR，并指导用户去控制台确认',async()=>{
  for(const baseUrl of ['','https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','http://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1']){
    const spy=spyFetch(asrAnswer('should not be called'));
    await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:baseUrl,fetchImpl:spy.fn},async base=>{
      const r=await upload(base,formBody());
      assert.equal(r.status,503,baseUrl||'(empty)');
      assert.equal(r.body.error.code,'PROVIDER_CONFIG_ERROR');
      assert.equal(spy.calls.length,0);
    });
  }
});

test('鉴权失败、模型不可用与供应商故障按错误表映射 HTTP 状态',async()=>{
  const table=[[401,503,'PROVIDER_AUTH_ERROR'],[403,503,'PROVIDER_AUTH_ERROR'],[404,502,'PROVIDER_MODEL_UNAVAILABLE'],[429,502,'PROVIDER_HTTP_ERROR'],[500,502,'PROVIDER_HTTP_ERROR']];
  for(const [providerStatus,expectedHttp,expectedCode] of table){
    const spy=spyFetch({}, {status:providerStatus});
    await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn},async base=>{
      const r=await upload(base,formBody());
      assert.equal(r.status,expectedHttp,`供应商 HTTP ${providerStatus}`);
      assert.equal(r.body.success,false);
      assert.equal(r.body.error.code,expectedCode);
      assert.ok(!r.text.includes(BAILIAN_KEY));
    });
  }
});

test('断网与超时归为可重试错误，非法 JSON 响应不产出文本',async()=>{
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:async()=>{throw new Error('socket hang up')}},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,502);
    assert.equal(r.body.error.code,'PROVIDER_NETWORK_ERROR');
    assert.equal(r.body.error.retryable,true);
  });
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:async()=>{const e=new Error('aborted');e.name='AbortError';throw e;}},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,504);
    assert.equal(r.body.error.code,'PROVIDER_TIMEOUT');
  });
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:null},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,503,'运行环境不支持 fetch 时明确报错，不伪装成转写成功。');
    assert.equal(r.body.error.code,'FETCH_UNAVAILABLE');
  });
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:async()=>({ok:true,status:200,json:async()=>({})})},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,502);
    assert.equal(r.body.error.code,'PROVIDER_BAD_RESPONSE');
  });
});

test('服务端日志只记录方法、路径、状态、耗时与字节数',async()=>{
  const lines=[];
  const spy=spyFetch(asrAnswer('A secret sentence that must never be logged.'));
  await withServer({provider:'bailian',bailianApiKey:BAILIAN_KEY,bailianBaseUrl:BEIJING_BASE,fetchImpl:spy.fn,log:l=>lines.push(JSON.stringify(l))},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,200);
  });
  const joined=lines.join('\n');
  assert.ok(joined.includes('"path":"/api/transcribe"'));
  assert.ok(joined.includes('"status":200'));
  for(const forbidden of ['A secret sentence',BAILIAN_KEY,'base64','个人陈述','s-7'])
    assert.ok(!joined.includes(forbidden),`日志不应包含 ${forbidden}`);
});

test('openai 通路在新增百炼分支后仍按原样工作',async()=>{
  const calls=[];
  const fn=async(url,init)=>{calls.push({url,init});return {ok:true,status:200,json:async()=>({text:'Legacy OpenAI transcript.',languages:['en']})};};
  await withServer({provider:'openai',apiKey:OPENAI_KEY,fetchImpl:fn},async base=>{
    const r=await upload(base,formBody());
    assert.equal(r.status,200);
    assert.equal(r.body.data.transcript,'Legacy OpenAI transcript.');
    assert.deepEqual(r.body.data.detectedLanguages,['en']);
    assert.equal(calls[0].url,'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(calls[0].init.headers.Authorization,`Bearer ${OPENAI_KEY}`);
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.body.get('model'),'gpt-transcribe');
  });
});
