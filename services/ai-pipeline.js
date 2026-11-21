/* ─────────────── AI 分析流水线（转写 → 校对 → 评分） ───────────────
   报告页用它按阶段驱动真实链路，状态互相独立：
     idle 未开始分析 → transcribing 正在转写 → transcribed 转写成功
     → scoring 正在评分 → done 分析完成
     → failed 分析失败（可重试）
     → no_evidence 未录音或证据不足（不提交评分）

   这个模块是唯一的「防重复付费 / 防过期覆盖」的地方：
     · 同一阶段的同类请求只会有一个在途 Promise，重复点击复用同一个。
     · 每次 begin()/cancel() 都让 ticket 递增，晚到的响应一律丢弃。
     · 原始转写与用户修改后的文本分开保存，评分用哪一份写进报告里。
   本模块不产生任何分数或文本，只做编排与状态保存。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var STATUS_TEXT = {
    idle: "未开始分析",
    transcribing: "正在转写",
    transcribed: "转写成功，待你确认",
    scoring: "正在评分",
    done: "分析完成",
    failed: "分析失败",
    no_evidence: "未录音或证据不足"
  };

  var P = {
    kind: "ai-pipeline",
    /* 当前分析归属的这一轮：sessionId 与 ticket 任一变化都作废在途请求 */
    sessionId: null,
    ticket: 0,
    context: null,
    stages: Object.create(null),
    _inflight: Object.create(null),
    _controllers: []
  };
  /* 每个阶段一条独立状态；不在构造函数里发请求。 */
  P._stage = function (phase) {
    return {
      key: phase.key,
      name: phase.name || phase.key,
      stage: null,
      status: "idle",
      attempts: 0,
      /* 原始转写与用户编辑严格分开：original 永不被覆盖，edited 为空表示用户没改 */
      original: "",
      edited: "",
      transcriptSource: null,
      error: null,
      report: null,
      transcribeMeta: null,
      startedAt: null,
      finishedAt: null
    };
  };

  /**
   * 开始新一轮分析：作废旧轮次的在途请求，并按阶段列表重建状态。
   * context = { sessionId, examType, phases:[{key,name,question,questionId,targetDurationSeconds,assessedSpeaker,speakerTurns}] }
   */
  P.begin = function (context) {
    this.cancel("已经开始新一轮分析");
    this.context = context || null;
    this.sessionId = context ? context.sessionId : null;
    this.stages = Object.create(null);
    var list = (context && context.phases) || [];
    for (var i = 0; i < list.length; i++) {
      var st = this._stage(list[i]);
      st.stage = (window.TOPE_Evaluation && window.TOPE_Evaluation.stageKey(context.examType, list[i].key)) || null;
      this.stages[list[i].key] = st;
    }
    return this.states();
  };

  P.get = function (key) { return this.stages[key] || null; };

  /* 给界面用的浅快照，避免外部直接改内部状态。 */
  P.states = function () {
    var out = [];
    for (var key in this.stages) {
      if (!Object.prototype.hasOwnProperty.call(this.stages, key)) continue;
      var s = this.stages[key];
      out.push({
        key: s.key, name: s.name, stage: s.stage, status: s.status,
        statusText: STATUS_TEXT[s.status] || s.status,
        attempts: s.attempts, original: s.original, edited: s.edited,
        transcriptSource: s.transcriptSource, error: s.error,
        report: s.report, transcribeMeta: s.transcribeMeta,
        busy: !!this._inflight[s.key]
      });
    }
    return out;
  };

  P.busy = function () {
    for (var k in this._inflight) if (Object.prototype.hasOwnProperty.call(this._inflight, k)) return true;
    return false;
  };

  /** 作废全部在途请求：离开报告页、开始新考试、用户点「停止」都走这里。 */
  P.cancel = function (reason) {
    this.ticket++;
    var controllers = this._controllers || [];
    for (var i = 0; i < controllers.length; i++) {
      try { controllers[i].abort(); } catch (e) { /* 已结束的请求忽略 */ }
    }
    this._controllers = [];
    this._inflight = Object.create(null);
    for (var key in this.stages) {
      if (!Object.prototype.hasOwnProperty.call(this.stages, key)) continue;
      var s = this.stages[key];
      /* 只回退「正在进行」的状态，已完成的结果保留。 */
      if (s.status === "transcribing" || s.status === "scoring") {
        s.status = s.original ? "transcribed" : "idle";
        s.error = { code: "CANCELLED", message: reason || "已取消本次请求。", retryable: true };
      }
    }
    return reason || "已取消";
  };

  P._controller = function () {
    var c = typeof AbortController === "function" ? new AbortController() : null;
    if (!this._controllers) this._controllers = [];
    if (c) this._controllers.push(c);
    return c;
  };

  P._isStale = function (ticket, key) {
    if (ticket !== this.ticket) return true;
    var s = this.stages[key];
    return !s;
  };

  P._release = function (key, promise) {
    if (this._inflight[key] === promise) delete this._inflight[key];
    return promise;
  };

  /* 阶段可用的录音：必须存在且有字节。complete:false 只提示不完整，不阻止分析。 */
  P._audioOf = function (key) {
    var rec = window.TOPE_Recorder && window.TOPE_Recorder.get && window.TOPE_Recorder.get(key);
    if (!rec || !rec.blob || !rec.blob.size) return null;
    return rec;
  };

  P._phaseContext = function (key) {
    var list = (this.context && this.context.phases) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  };

  /** 转写一个阶段。重复点击复用同一个在途 Promise，不会产生第二次上传。 */
  P.transcribe = function (key) {
    var self = this;
    var s = this.stages[key];
    if (!s) return Promise.resolve(null);
    if (this._inflight[key]) return this._inflight[key];
    var audio = this._audioOf(key);
    if (!audio) {
      s.status = "no_evidence";
      s.error = { code: "MISSING_AUDIO", message: "这一阶段没有可用录音，无法转写。可以重新练习这一阶段，或在下方手动粘贴文本。", retryable: false };
      return Promise.resolve(s);
    }
    var ticket = this.ticket;
    s.status = "transcribing";
    s.error = null;
    s.attempts++;
    s.startedAt = Date.now();
    var ctrl = this._controller();
    var phase = this._phaseContext(key) || {};
    var p = window.TOPE_Transcription.transcribe({
      audioBlob: audio.blob,
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
      sessionId: this.sessionId,
      examType: this.context ? this.context.examType : null,
      stage: s.stage || key,
      stageName: s.name,
      questionId: phase.questionId || null,
      language: ((window.TOPE_CONFIG || {}).scoring || {}).language || "en"
    }, ctrl ? ctrl.signal : undefined).then(function (res) {
      if (self._isStale(ticket, key)) return self.stages[key] || null;
      if (!res.success) {
        s.status = res.status === "no_audio" ? "no_evidence" : "failed";
        s.error = { code: res.code, message: res.message, retryable: !!res.retryable };
        return s;
      }
      s.original = res.transcript;
      s.edited = "";
      s.transcriptSource = res.transcript.trim() ? "original" : null;
      s.transcribeMeta = { model: res.model, format: res.format, bytesReceived: res.bytesReceived, demoOnly: !!res.demoOnly, at: Date.now() };
      s.finishedAt = Date.now();
      /* 空转写是「证据不足」而不是失败：静音不该被当成可评分的文本。 */
      s.status = res.transcript.trim() ? "transcribed" : "no_evidence";
      if (!res.transcript.trim()) s.error = { code: "NO_SPEECH", message: "转写服务在这段录音里没有听到可用语音，未提交评分。", retryable: false };
      return s;
    }, function (err) {
      if (self._isStale(ticket, key)) return self.stages[key] || null;
      s.status = "failed";
      s.error = { code: "UNEXPECTED", message: "转写流程异常：" + ((err && err.message) || "未知错误"), retryable: true };
      return s;
    });
    /* in-flight 里存的必须是最终返回的那个 Promise，重复调用才会复用同一个请求而不是再发一次 */
    var wrapped = p.then(function (v) { self._release(key, wrapped); return v; },
                          function (e) { self._release(key, wrapped); throw e; });
    this._inflight[key] = wrapped;
    return wrapped;
  };

  /**
   * 用户明确同意「这段录音没确认完整，仍按现有内容评分」时才置位。
   * 默认关闭：不完整录音不会被当成完整回答偷偷提交（任务书第 6 节）。
   */
  P.confirmIncomplete = function (key) {
    var phase = this._phaseContext(key);
    if (!phase) return false;
    phase.allowIncomplete = true;
    return true;
  };

  /** 用户改写文本时调用：只动 edited，original 保持不动。 */
  P.setTranscript = function (key, text) {
    var s = this.stages[key];
    if (!s) return null;
    s.edited = String(text || "");
    s.transcriptSource = s.edited !== s.original ? "edited" : (s.original ? "original" : null);
    if (s.status === "no_evidence" && s.edited.trim()) { s.status = "transcribed"; s.error = null; }
    return s;
  };

  P.effectiveTranscript = function (key) {
    var s = this.stages[key];
    if (!s) return "";
    return s.edited !== "" ? s.edited : s.original;
  };

  /** 评分一个阶段。没有确认过的文本时直接标为证据不足，不发请求。 */
  P.score = function (key) {
    var self = this;
    var s = this.stages[key];
    if (!s) return Promise.resolve(null);
    if (this._inflight[key]) return this._inflight[key];
    var transcript = this.effectiveTranscript(key);
    if (!transcript.trim()) {
      s.status = "no_evidence";
      s.error = { code: "EMPTY_TRANSCRIPT", message: "还没有可用的转写文本，先完成转写或手动补充文本再评分。", retryable: false };
      return Promise.resolve(s);
    }
    if (!s.stage) {
      s.status = "failed";
      s.error = { code: "UNMAPPED_STAGE", message: "这一阶段没有对应的评分阶段键，未提交评分。", retryable: false };
      return Promise.resolve(s);
    }
    var phase = this._phaseContext(key) || {};
    if (!phase.question) {
      s.status = "failed";
      s.error = { code: "MISSING_QUESTION", message: "缺少题目文本，未提交评分。", retryable: false };
      return Promise.resolve(s);
    }
    var audio = this._audioOf(key);
    if (!phase.allowIncomplete && audio && audio.complete === false) {
      s.status = "no_evidence";
      s.error = { code: "INCOMPLETE_RECORDING", message: "这段录音没能确认完整结束，默认不提交为完整回答评分。可以先听一遍回放，或重新练习这一阶段。", retryable: false };
      return Promise.resolve(s);
    }
    var ticket = this.ticket;
    s.status = "scoring";
    s.error = null;
    s.attempts++;
    var ctrl = this._controller();
    var p = window.TOPE_Evaluation.evaluate({
      examType: this.context.examType,
      phaseKey: key,
      stage: s.stage,
      stageName: s.name,
      question: phase.question,
      questionId: phase.questionId || null,
      transcript: transcript,
      durationSeconds: audio ? audio.durationSeconds : phase.durationSeconds || 0,
      targetDurationSeconds: phase.targetDurationSeconds || null,
      assessedSpeaker: phase.assessedSpeaker || null,
      speakerTurns: phase.speakerTurns || null,
      sessionId: this.sessionId
    }, ctrl ? ctrl.signal : undefined).then(function (res) {
      if (self._isStale(ticket, key)) return self.stages[key] || null;
      s.finishedAt = Date.now();
      if (!res.success) {
        s.status = "failed";
        s.error = { code: res.code, message: res.message, retryable: !!res.retryable };
        s.report = null;
        return s;
      }
      s.report = res;
      s.status = "done";
      /* 把实际用于评分的文本记在报告上，页面才能诚实区分原始/编辑文本。 */
      s.report.usedTranscript = transcript;
      s.report.transcriptSource = s.transcriptSource;
      s.report.recordingComplete = audio ? audio.complete !== false : null;
      return s;
    }, function (err) {
      if (self._isStale(ticket, key)) return self.stages[key] || null;
      s.status = "failed";
      s.error = { code: "UNEXPECTED", message: "评分流程异常：" + ((err && err.message) || "未知错误"), retryable: true };
      return s;
    });
    /* in-flight 里存的必须是最终返回的那个 Promise，重复调用才会复用同一个请求而不是再发一次 */
    var wrapped = p.then(function (v) { self._release(key, wrapped); return v; },
                          function (e) { self._release(key, wrapped); throw e; });
    this._inflight[key] = wrapped;
    return wrapped;
  };

  /**
   * 顺序跑完所有可分析阶段：一次只发一个请求，避免并发打出多份付费调用。
   * 任一步失败都只影响该阶段，其余继续。
   */
  P.analyzeAll = function () {
    var self = this;
    var keys = Object.keys(this.stages);
    var chain = Promise.resolve();
    this._batch = this.ticket;
    keys.forEach(function (key) {
      chain = chain.then(function () {
        if (self._batch !== self.ticket) return null;
        var s = self.stages[key];
        if (!s || s.status === "done" || s.status === "no_evidence") return s;
        if (!self._audioOf(key) && !self.effectiveTranscript(key).trim()) {
          s.status = "no_evidence";
          s.error = { code: "MISSING_AUDIO", message: "这一阶段没有可用录音，已跳过。", retryable: false };
          return s;
        }
        if (!self.effectiveTranscript(key).trim()) return self.transcribe(key);
        return s;
      }).then(function () {
        if (self._batch !== self.ticket) return null;
        var s = self.stages[key];
        if (!s || s.status === "done" || s.status === "no_evidence" || s.status === "transcribing" || s.status === "scoring") return s;
        if (!self.effectiveTranscript(key).trim()) return s;
        return self.score(key);
      });
    });
    return chain.then(function () { return self.states(); });
  };

  P.statusLabels = STATUS_TEXT;

  window.TOPE_Pipeline = P;
})();
