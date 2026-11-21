/* 阿里云百炼 qwen3-asr-flash 转写通路的离线模拟测试：不发真实请求、不使用真实密钥。
   覆盖任务书要求：北京地域 Base URL、模型名称、百炼转写请求结构、WebM/Opus 输入处理、
   转写文本解析、鉴权失败、模型不存在/地域不可用、网络中断与超时、
   时长与体积超限（明确报错、不静默截断）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transcribeWithBailian,bailianChatUrl,toDataUri,
  BAILIAN_ASR_MODEL,BAILIAN_ASR_FORMATS,BAILIAN_MAX_ENCODED_BYTES,BAILIAN_MAX_RAW_BYTES,
  BAILIAN_MAX_AUDIO_SECONDS,ASR_LANGUAGE_CODES,WORKSPACE_ID_PLACEHOLDER,DEFAULT_BAILIAN_BASE_URL
} from '../src/bailian-provider.mjs';

const BEIJING_BASE='https://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const BEIJING_URL=`${BEIJING_BASE}/chat/completions`;
const FAKE_KEY='FAKE_BAILIAN_KEY_offline_only';
const OPT={apiKey:FAKE_KEY,baseUrl:BEIJING_BASE};
// 一段伪造的 WebM/Opus 字节：以官方魔数开头，内容本身不含任何真实录音。
const WEBM = Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]), Buffer.from('fake-opus-bytes-for-offline-tests'.repeat(4))]);

function recorder(response,{status=200,jsonThrows=false}={}){
  const calls=[];
  const fn=async(url,init)=>{
    calls.push({url,init,body:JSON.parse(init.body)});
    return {ok:status>=200&&status<300,status,json:async()=>{if(jsonThrows)throw new Error('unparseable');return response;}};
  };
  return {calls,fn};
}
const neverFetch=async()=>{throw new Error('离线测试不允许发出真实请求。');};
const asrAnswer=(text,model=BAILIAN_ASR_MODEL)=>({model,choices:[{finish_reason:'stop',message:{content:text}}]});

test('北京地域 Base URL 解析为 chat/completions；百炼没有 /audio/transcriptions 路径',()=>{
  assert.equal(bailianChatUrl(BEIJING_BASE),BEIJING_URL);
  assert.equal(bailianChatUrl(`${BEIJING_BASE}/`),BEIJING_URL);
  assert.equal(bailianChatUrl(BEIJING_URL),BEIJING_URL);
  assert.ok(!bailianChatUrl(BEIJING_BASE).includes('/audio/transcriptions'));
  assert.ok(!bailianChatUrl(BEIJING_BASE).includes(WORKSPACE_ID_PLACEHOLDER));
  for(const [bad,reason] of [['','BAILIAN_BASE_URL'],[`https://${WORKSPACE_ID_PLACEHOLDER}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,'WorkspaceId'],['http://llm-placeholder.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','https']]){
    assert.throws(()=>bailianChatUrl(bad),new RegExp(reason));
  }
});

test('百炼转写请求走 Chat Completions + input_audio + Base64 Data URI',async()=>{
  const rec=recorder(asrAnswer('Good morning examiners.'));
  const out=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm;codecs=opus',language:'en'},{...OPT,fetchImpl:rec.fn});
  assert.equal(rec.calls.length,1);
  assert.equal(rec.calls[0].url,BEIJING_URL);
  assert.equal(rec.calls[0].init.method,'POST');
  assert.equal(rec.calls[0].init.headers.Authorization,`Bearer ${FAKE_KEY}`);
  assert.equal(rec.calls[0].init.headers['Content-Type'],'application/json');
  const body=rec.calls[0].body;
  assert.equal(body.model,BAILIAN_ASR_MODEL);
  assert.equal(body.model,'qwen3-asr-flash');
  assert.equal(body.stream,false);
  assert.equal(body.messages.length,1);
  assert.equal(body.messages[0].role,'user');
  assert.equal(body.messages[0].content.length,1,'单次只允许 1 个音频。');
  assert.equal(body.messages[0].content[0].type,'input_audio');
  assert.equal(typeof body.messages[0].content[0].input_audio.data,'string');
  assert.ok(body.messages[0].content[0].input_audio.data.startsWith('data:audio/webm;base64,'));
  assert.deepEqual(body.asr_options,{language:'en',enable_itn:false});
  // 既没有 multipart 字段，也没有把本地文件路径当成模型可访问的 URL。
  for(const forbidden of ['file','audio','language','input_audio']) assert.ok(!(forbidden in body),`请求体不应直接携带 ${forbidden}`);
  assert.ok(!body.messages[0].content[0].input_audio.data.includes(process.cwd()),'绝不把本地文件路径当作模型可访问的地址。');
  assert.ok(!body.messages[0].content[0].input_audio.data.startsWith('file:'));
  assert.equal(out.transcript,'Good morning examiners.');
  assert.equal(out.format,'webm');
  assert.equal(out.bytes,WEBM.length);
});

test('Data URI 解码后与收到的录音字节逐字节相同：不截断、不改造',async()=>{
  const rec=recorder(asrAnswer('x'));
  await transcribeWithBailian({audio:WEBM,mimeType:'audio/ogg',language:'en'},{...OPT,fetchImpl:rec.fn});
  const data=rec.calls[0].body.messages[0].content[0].input_audio.data;
  const payload=data.slice('data:audio/ogg;base64,'.length);
  assert.ok(Buffer.from(payload,'base64').equals(WEBM));
  assert.equal(toDataUri(Buffer.from([1,2,3]),'audio/wav'),'data:audio/wav;base64,AQID');
});

test('官方格式白名单：WebM/Opus、OGG、WAV、MP3、FLAC 可上传，m4a/mp4 明确拒绝且不出网',()=>{
  assert.deepEqual(Object.keys(BAILIAN_ASR_FORMATS).sort(),['flac','mp3','ogg','wav','webm']);
  assert.ok(!('m4a' in BAILIAN_ASR_FORMATS));
});

test('Safari 的 M4A/MP4 录音在百炼转写通路上被拒绝，并提示可用格式',async()=>{
  for(const mime of ['audio/mp4','audio/x-m4a','audio/aac','video/mp4','audio/360']){
    const rec=recorder(asrAnswer('should not run'));
    await assert.rejects(
      transcribeWithBailian({audio:WEBM,mimeType:mime,language:'en'},{...OPT,fetchImpl:rec.fn}),
      err=>{assert.equal(err.code,'UNSUPPORTED_FORMAT');assert.equal(err.retryable,false);return true;}
    );
    assert.equal(rec.calls.length,0,`${mime} 不应产生外部调用`);
  }
  const m4a=recorder(asrAnswer('x'));
  await assert.rejects(
    transcribeWithBailian({audio:WEBM,mimeType:'audio/mp4',language:'en'},{...OPT,fetchImpl:m4a.fn}),
    err=>{assert.match(err.message,/m4a/);assert.match(err.message,/Chrome|Edge/);return true;}
  );
});

test('单次超过 5 分钟的录音明确报错，绝不截断后当作完整转写',async()=>{
  for(const seconds of [301,3600,99999]){
    const rec=recorder(asrAnswer('should not run'));
    await assert.rejects(
      transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',language:'en',durationSeconds:seconds},{...OPT,fetchImpl:rec.fn}),
      err=>{assert.equal(err.code,'AUDIO_TOO_LONG');assert.match(err.message,/5 分钟|300 秒/);return true;}
    );
    assert.equal(rec.calls.length,0);
  }
  assert.equal(BAILIAN_MAX_AUDIO_SECONDS,300);
  const ok=recorder(asrAnswer('exactly at the limit'));
  const out=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',language:'en',durationSeconds:300},{...OPT,fetchImpl:ok.fn});
  assert.equal(out.transcript,'exactly at the limit');
});

test('Base64 编码后超过 10 MB 的录音在出网前拒绝',async()=>{
  assert.equal(BAILIAN_MAX_ENCODED_BYTES,10*1024*1024);
  assert.ok(BAILIAN_MAX_RAW_BYTES*4/3<BAILIAN_MAX_ENCODED_BYTES,'原始上限折算成 Base64 后必须仍留有余量。');
  const rec=recorder(asrAnswer('should not run'));
  await assert.rejects(
    transcribeWithBailian({audio:Buffer.alloc(BAILIAN_MAX_RAW_BYTES+8192,7),mimeType:'audio/wav',language:'en'},{...OPT,fetchImpl:rec.fn}),
    err=>{assert.equal(err.code,'AUDIO_TOO_LARGE');assert.match(err.message,/10 MB/);return true;}
  );
  assert.equal(rec.calls.length,0);
  const fits=recorder(asrAnswer('just under the cap'));
  assert.equal((await transcribeWithBailian({audio:Buffer.alloc(BAILIAN_MAX_RAW_BYTES,7),mimeType:'audio/wav',language:'en'},{...OPT,fetchImpl:fits.fn})).transcript,'just under the cap');
});

test('语种提示按官方取值表下发：en-US 归一为 en，混合语种省略 language',async()=>{
  const seen=async(payload={})=>{
    const rec=recorder(asrAnswer('t'));
    await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',...payload},{...OPT,fetchImpl:rec.fn});
    return rec.calls[0].body.asr_options;
  };
  assert.deepEqual(await seen({language:'en'}),{language:'en',enable_itn:false});
  assert.deepEqual(await seen({language:'en-US'}),{language:'en',enable_itn:false});
  assert.deepEqual(await seen({language:'ZH-CN'}),{language:'zh',enable_itn:false});
  assert.deepEqual(await seen({language:'no'}),{language:'no',enable_itn:false});
  assert.deepEqual(await seen({language:'eo'}),{enable_itn:false},'不在官方取值表内的语种不猜。');
  assert.deepEqual(await seen({}),{language:'en',enable_itn:false},'未指明时按产品默认英语。');
  assert.equal(ASR_LANGUAGE_CODES.includes('en'),true);
  assert.equal(new Set(ASR_LANGUAGE_CODES).size,ASR_LANGUAGE_CODES.length,'语种代码表不允许重复项。');
});

test('enable_itn 默认关闭，打开后随 asr_options 下发',async()=>{
  const rec=recorder(asrAnswer('t'));
  await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',language:'zh'},{...OPT,fetchImpl:rec.fn});
  assert.equal(rec.calls[0].body.asr_options.enable_itn,false);
  await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',language:'zh'},{...OPT,enableItn:true,fetchImpl:rec.fn});
  assert.equal(rec.calls[1].body.asr_options.enable_itn,true);
});

test('BAILIAN_ASR_MODEL 可覆盖模型 ID，便于换成已开通的其他 ASR 模型',async()=>{
  const rec=recorder(asrAnswer('t','qwen3-asr-flash-2026'));
  const out=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',language:'en'},{...OPT,model:'qwen3-asr-flash-2026',fetchImpl:rec.fn});
  assert.equal(rec.calls[0].body.model,'qwen3-asr-flash-2026');
  assert.equal(out.model,'qwen3-asr-flash-2026');
});

test('转写文本解析：字符串、分段数组与静音空文本',async()=>{
  const parts={model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'stop',message:{content:[{type:'text',text:'Hello '},{type:'text',text:'there.'}]}}]};
  const rec=recorder(parts);
  assert.equal((await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:rec.fn})).transcript,'Hello there.');
  const silence=recorder(asrAnswer('   '));
  const empty=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:silence.fn});
  assert.equal(empty.transcript,'   ');
  assert.equal(empty.transcript.trim().length,0,'静音只返回空文本，由页面显示「没有可用语音」。');
});

test('响应形态异常一律不产出文本',async()=>{
  for(const [payload,label] of [
    [{model:BAILIAN_ASR_MODEL,choices:[]},'空 choices'],
    [{model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'stop',message:{}}]},'content 缺失'],
    [{model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'stop',message:{content:{text:'x'}}}]},'content 非字符串'],
    [{model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'length',message:{content:'partial'}}]},'被长度截断'],
    ['not json','响应不是对象'],'{','响应是字符串'
  ]){
    const rec=recorder(payload);
    await assert.rejects(
      transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:rec.fn}),
      err=>{assert.equal(err.code,'PROVIDER_BAD_RESPONSE',label);assert.equal(err.retryable,true,label);return true;}
    );
  }
  const broken=recorder(asrAnswer('t'),{jsonThrows:true});
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:broken.fn}),err=>err.code==='PROVIDER_BAD_RESPONSE');
});

test('鉴权失败、模型不存在与限流映射为可诊断错误码，且不回显密钥',async()=>{
  const table=[
    [401,'PROVIDER_AUTH_ERROR',false],[403,'PROVIDER_AUTH_ERROR',false],
    [404,'PROVIDER_MODEL_UNAVAILABLE',false],[429,'PROVIDER_HTTP_ERROR',true],
    [500,'PROVIDER_HTTP_ERROR',true],[503,'PROVIDER_HTTP_ERROR',true]
  ];
  for(const [status,expected,retryable] of table){
    const rec=recorder({error:{message:'internal'}},{status});
    await assert.rejects(
      transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:rec.fn}),
      err=>{
        assert.equal(err.code,expected,`HTTP ${status}`);
        assert.equal(err.retryable,retryable,`HTTP ${status} retryable`);
        assert.ok(!err.message.includes(FAKE_KEY));
        assert.ok(!err.message.includes('llm-placeholder'));
        assert.ok(!err.message.includes(WEBM.toString('base64').slice(0,16)));
        return true;
      }
    );
  }
});

test('超时与网络中断分别归为 PROVIDER_TIMEOUT 与 PROVIDER_NETWORK_ERROR',async()=>{
  await assert.rejects(
    transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:async()=>{const e=new Error('aborted');e.name='AbortError';throw e;}}),
    err=>{assert.equal(err.code,'PROVIDER_TIMEOUT');assert.equal(err.retryable,true);return true;}
  );
  await assert.rejects(
    transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:async()=>{throw new Error('socket hang up')}}),
    err=>{assert.equal(err.code,'PROVIDER_NETWORK_ERROR');assert.equal(err.retryable,true);return true;}
  );
});

test('校验顺序：空音频、不支持格式、超长录音都排在密钥与网络之前',async()=>{
  const opts={...OPT,fetchImpl:neverFetch,apiKey:''};
  await assert.rejects(transcribeWithBailian({audio:Buffer.alloc(0),mimeType:'audio/webm'},{...opts}),err=>err.code==='EMPTY_AUDIO');
  await assert.rejects(transcribeWithBailian({audio:null,mimeType:'audio/webm'},{...opts}),err=>err.code==='EMPTY_AUDIO');
  await assert.rejects(transcribeWithBailian({audio:'not-a-buffer',mimeType:'audio/webm'},{...opts}),err=>err.code==='EMPTY_AUDIO');
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/360'},{...opts}),err=>err.code==='UNSUPPORTED_FORMAT');
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/webm',durationSeconds:600},{...opts}),err=>err.code==='AUDIO_TOO_LONG');
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...opts}),err=>err.code==='API_KEY_MISSING');
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,baseUrl:'',fetchImpl:neverFetch}),err=>err.code==='PROVIDER_CONFIG_ERROR');
  await assert.rejects(transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:null}),err=>err.code==='FETCH_UNAVAILABLE');
});

test('录音字节与转写文本不进入任何抛出对象',async()=>{
  const rec=recorder({model:BAILIAN_ASR_MODEL,choices:[{finish_reason:'stop',message:{content:'x'.repeat(500)}}]});
  const out=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:rec.fn});
  assert.deepEqual(Object.keys(out).sort(),['bytes','format','languages','model','transcript']);
  assert.deepEqual(out.languages,[],'qwen3-asr-flash 不在响应里报告语种检测。');
  const err=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{...OPT,fetchImpl:async()=>{throw new Error('boom')}}).catch(e=>e);
  assert.ok(!String(err.message).includes('x'.repeat(64)));
  assert.ok(!rec.calls[0].init.body.includes(out.transcript));
});

/* ── 成员 B 实测地址带来的两项保证：默认 Base URL 免 WorkspaceId，且留空即用 ───── */
test('默认 Base URL 是评分通路已实测通过的 dashscope 域名，ASR 只需要换成 chat/completions 路径',()=>{
  assert.equal(DEFAULT_BAILIAN_BASE_URL,'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.ok(!DEFAULT_BAILIAN_BASE_URL.includes(WORKSPACE_ID_PLACEHOLDER));
  assert.equal(bailianChatUrl(DEFAULT_BAILIAN_BASE_URL),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(bailianChatUrl(`${DEFAULT_BAILIAN_BASE_URL}/chat/completions`),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
});

test('留空 BAILIAN_BASE_URL 即用默认实测地址；请求里不含本地文件路径，也不会拼出 /responses',async()=>{
  const saved=process.env.BAILIAN_BASE_URL;
  delete process.env.BAILIAN_BASE_URL;
  try{
    const rec=recorder(asrAnswer('Hello.'));
    const out=await transcribeWithBailian({audio:WEBM,mimeType:'audio/webm;codecs=opus',language:'en'},{apiKey:FAKE_KEY,fetchImpl:rec.fn});
    assert.equal(rec.calls.length,1);
    assert.equal(rec.calls[0].url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(out.transcript,'Hello.');
    assert.ok(!rec.calls[0].url.includes('/responses'),'转写走 Chat Completions，不能被评分通路的 Responses 接口带偏。');
    assert.ok(!rec.calls[0].init.body.includes(process.cwd()),'不允许把本地文件绝对路径当成模型可访问的 URL。');
  }finally{
    if(saved===undefined)delete process.env.BAILIAN_BASE_URL;else process.env.BAILIAN_BASE_URL=saved;
  }
});

test('显式留空 baseUrl 视为配置缺失，直接 PROVIDER_CONFIG_ERROR 且零次出网',async()=>{
  let called=0;
  await assert.rejects(
    transcribeWithBailian({audio:WEBM,mimeType:'audio/webm'},{apiKey:FAKE_KEY,baseUrl:'',fetchImpl:async()=>{called++;throw new Error('no');}}),
    err=>err.code==='PROVIDER_CONFIG_ERROR'
  );
  assert.equal(called,0);
});
