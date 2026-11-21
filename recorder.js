/* ───────────────────────── TOPE Mate 录音模块 ─────────────────────────
   只用浏览器原生 getUserMedia + MediaRecorder，无第三方依赖。
   每个考试阶段的录音独立存在 R.data[phaseKey]，互不覆盖：
     R.data.speech = { blob, mimeType, durationSeconds, url, stage, name }
   本模块不碰 DOM（回放与下载控件由 app.js 渲染），方便以后把 blob 交给转写服务。
   注意：录音只在内存里，不写盘、不上传，刷新页面即消失。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* 按优先级探测浏览器真正支持的编码，不假定 MP3 可用 */
  const MIME_TRIES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/x-m4a",
    "audio/mpeg"
  ];

  const STATE_LABEL = {
    idle: "未录制",
    pending: "等待授权",
    ready: "未录制（麦克风已就绪）",
    recording: "录音中",
    paused: "录音已暂停",
    starting: "正在启动麦克风",
    declined: "已选择不用麦克风",
    denied: "权限被拒绝",
    error: "麦克风不可用",
    unsupported: "本浏览器不支持录音"
  };

  function humanError(name) {
    switch (name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "麦克风权限被拒绝：计时与考试流程照常，但无法录音，也无法做真实语音评分。";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "没有找到麦克风设备：请确认耳机或麦克风已插入。";
      case "NotReadableError":
      case "TrackStartError":
        return "麦克风被其他程序占用：关闭会议软件或录音程序后重试。";
      case "SecurityError":
        return "当前打开方式不允许使用麦克风：请通过 localhost 预览打开（双击「启动预览.bat」）。";
      default:
        return "麦克风获取失败：" + (name || "未知错误") + "。考试流程不受影响。";
    }
  }

  function extOf(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.indexOf("webm") >= 0) return "webm";
    if (m.indexOf("ogg") >= 0) return "ogg";
    if (m.indexOf("mpeg") >= 0) return "mp3";
    if (m.indexOf("mp4") >= 0 || m.indexOf("m4a") >= 0 || m.indexOf("aac") >= 0) return "m4a";
    return "audio";
  }

  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
  }

  /* onstop 兜底时限：万一浏览器不派发 onstop，也不能把考试流程卡住。
     注意这只用来「不再等」，不代表数据已经齐了——超时保存的段会标记 complete:false。 */
  const CLOSE_TIMEOUT_MS = 1200;
  /* 超时之后还给浏览器这么长的窗口；晚到的分片会把那一段重新拼成完整文件 */
  const LATE_WINDOW_MS = 6000;
  const TIMESLICE_MS = 1000;

  const R = {
    state: "idle",
    message: "尚未请求麦克风权限",
    stream: null,
    mimeType: "",
    rec: null,
    key: null,
    phaseName: "",
    activeMs: 0,
    lastResume: null,
    fallbackPaused: false,
    data: Object.create(null),
    _ensure: null,
    /* _ensure 是在哪一次麦克风生命周期下发出的：只有同一个 epoch 才允许复用。
       用户把授权弹窗晾在一边时那个 Promise 永远不兑现，跨轮次复用会把
       之后所有阶段的录音和「授权 / 重试录音」按钮一起卡死。 */
    _ensureEpoch: -1,

    /* 三个作废用的号码，解决「旧请求在新阶段/新页面上复活」的竞争：
       sessionId —— 每开始一轮考试 +1，只有当前轮的发起了录音才生效；
       _ticket   —— 每次启动/停止请求 +1，只有最后一次启动请求能真的开录音器；
       epoch     —— 放弃考试、返回首页、释放麦克风时 +1，晚到的授权结果直接关掉流。 */
    sessionId: 0,
    _ticket: 0,
    epoch: 0,
    /* 本轮待保存的录音：{ key, name, sessionId, epoch, buffers }，buffers 按录音器启动顺序排列 */
    pending: null,
    /* 正在进行的一次收尾（同一时刻只允许一次），以及暂停兜底里上一段的收尾承诺 */
    _stopping: null,
    _pendingClose: null,
    /* 上一次保存的结论：complete / timeout / no_data / cancelled，供界面如实显示 */
    lastSave: null,
    warning: "",
    lost: [],

    /* 启动中：从调用 start() 到录音器真的进入 recording 之间的这段时间。
       界面只有 state === "recording" 才允许显示「录音中」，其余情况显示「正在启动麦克风」，
       绝不能把「权限已授予」当成「录音已经开始」。 */
    starting: false,
    startingKey: null,
    _startSeq: 0,
    /* 用户在录音还没起来的时候就点了暂停：录音器一开起来就立刻停住，不偷偷录下去 */
    pauseIntent: false,
    /* 用户明确选择「不用麦克风」：不再弹权限框，考试/练习照常计时 */
    declined: false,
    /* 设备检查用的音量采样：只读电平，不建 MediaRecorder，不产生任何可保存的音频 */
    meterLevel: 0,
    _meter: null,

    label(state) { return STATE_LABEL[state || this.state] || "未录制"; },
    supported() { return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    isLive() { return this.state === "recording" || this.state === "paused"; },
    canPause() { return !!(this.rec && typeof this.rec.pause === "function" && typeof this.rec.resume === "function"); },
    has(key) { return !!this.data[key]; },
    get(key) { return this.data[key] || null; },
    sizeOf(key) { const r = this.data[key]; return r ? r.blob.size : 0; },
    mmss,

    /* 界面取状态只用这个：recording 严格等于「录音器确实在跑」，
       权限刚批下来、录音器还没起来时是 starting，不会误显示 REC。 */
    displayState() {
      if (this.state === "recording" || this.state === "paused") return this.state;
      if (this.starting) return "starting";
      if (this.declined) return "declined";
      return this.state;
    },

    /* ── 设备检查用的音量采样：只读电平，不创建 MediaRecorder，不产生可保存的音频 ── */
    meterStart() {
      const self = this;
      if (!this.stream) return false;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.meterStop();
      let ctx, an, src;
      try {
        ctx = new AC();
        an = ctx.createAnalyser();
        an.fftSize = 1024;
        src = ctx.createMediaStreamSource(this.stream);
        src.connect(an);
        if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {});
      } catch (e) { this.meterStop(); return false; }
      const buf = new Uint8Array(an.fftSize);
      this._meter = { ctx: ctx, an: an, src: src, buf: buf, timer: 0 };
      const tick = function () {
        const m = self._meter;
        if (!m) return;
        try {
          m.an.getByteTimeDomainData(m.buf);
          let sum = 0, peak = 0;
          for (let i = 0; i < m.buf.length; i++) {
            const v = (m.buf[i] - 128) / 128;
            sum += v * v;
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
          const rms = Math.sqrt(sum / m.buf.length);
          self.meterLevel = Math.min(1, rms * 3.2 + peak * 0.9);
        } catch (e) { self.meterLevel = 0; }
      };
      this._meter.timer = setInterval(tick, 80);
      tick();
      return true;
    },

    /* 检查完必须断开并关掉 AudioContext，否则它一直占着麦克风，正式录音可能起不来 */
    meterStop() {
      const m = this._meter;
      this._meter = null;
      this.meterLevel = 0;
      if (!m) return;
      if (m.timer) clearInterval(m.timer);
      try { if (m.src) m.src.disconnect(); } catch (e) {}
      try { if (m.an) m.an.disconnect(); } catch (e) {}
      try { if (m.ctx && m.ctx.state !== "closed" && m.ctx.close) m.ctx.close(); } catch (e) {}
    },

    /* 明确「不用麦克风」：停掉采样、释放设备，之后不再弹权限框，计时照常 */
    optOut() {
      const self = this;
      this.declined = true;
      this.meterStop();
      return this.stopMic().then(function () {
        if (self.state !== "unsupported") {
          self.state = "idle";
          self.message = "已选择不用麦克风：本次只计时，不录音，也无法做语音评分。";
        }
        return true;
      });
    },

    pickMime() {
      if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return "";
      for (let i = 0; i < MIME_TRIES.length; i++) {
        try { if (MediaRecorder.isTypeSupported(MIME_TRIES[i])) return MIME_TRIES[i]; } catch (e) { /* 忽略单个探测异常 */ }
      }
      return "";
    },

    /* 请求权限。必须在点击事件的同步调用栈里首次调用，才能带上用户手势。
       返回 Promise<"ready" | "denied" | "error" | "unsupported" | "cancelled">，任何失败都不抛出。
       "cancelled" 表示权限迟迟才批下来，但用户已经离开考试/回首页，流已被立刻关掉。 */
    ensure() {
      const self = this;
      if (!this.supported()) {
        this.state = "unsupported";
        this.message = "当前浏览器没有 MediaRecorder 或 getUserMedia，无法录音。改用最新版 Chrome / Edge 即可。";
        return Promise.resolve("unsupported");
      }
      /* 用户再次主动要求授权 = 退出「不用麦克风」模式 */
      this.declined = false;
      if (this._ensure && this._ensureEpoch === this.epoch) return this._ensure;
      /* 上一轮迟迟没有兑现的授权请求：不再复用，否则新的请求（含「重试录音」）会被它拖死 */
      this._ensure = null;
      if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === "live")) {
        this.state = "ready";
        this.message = "麦克风已就绪";
        return Promise.resolve("ready");
      }
      const epoch = this.epoch;
      this._ensureEpoch = epoch;
      this.state = "pending";
      this.message = "正在请求麦克风权限…";
      let p;
      try {
        p = navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        this._ensureEpoch = -1;
        this.state = "error";
        this.message = humanError(e && e.name);
        return Promise.resolve("error");
      }
      /* settled 自己也是这一次请求的身份证：一旦有更早的请求回来了或被新一轮请求顶替，
         它就再也不能改动 stream / state */
      let settled;
      settled = p.then(
        (stream) => {
          if (epoch !== self.epoch || self._ensure !== settled) {
            /* 等权限期间用户已放弃考试，或已经另起一次请求：不能把麦克风留在开着的状态 */
            try { stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); } catch (e) {}
            if (self.state === "pending" && self._ensure === settled) {
              self.state = "idle";
              self.message = "已取消麦克风请求。";
            }
            return "cancelled";
          }
          self.stream = stream;
          if (!self.mimeType) self.mimeType = self.pickMime();
          self.state = "ready";
          self.message = "麦克风已就绪";
          return "ready";
        },
        (err) => {
          const name = (err && err.name) || "";
          if (epoch !== self.epoch || self._ensure !== settled) return "cancelled";
          self.stream = null;
          self.state = name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error";
          self.message = humanError(name);
          return self.state;
        }
      ).then(function (s) {
        if (self._ensure === settled) { self._ensure = null; self._ensureEpoch = -1; }
        return s;
      });
      this._ensure = settled;
      return settled;
    },

    /* 开始某阶段的录音。会先等上一阶段的数据落盘，任何时刻只有一个录音器在跑。
       sid 传调用方当时所在的考试轮次号（Rec.sessionId）：等权限的这段时间里
       用户可能已经跳过阶段、结束考试或回首页，过期的启动请求必须作废。 */
    start(key, name, sid) {
      const self = this;
      const wantSession = sid == null ? this.sessionId : sid;
      let seq = 0;
      if (this.declined) {
        this.message = "已选择不用麦克风，本阶段不录音。";
        return Promise.resolve(false);
      }
      /* stop() 的同步部分会把「正在启动」清掉，所以先拿到它的收尾承诺，再同步标起来：
         这样调用方在同一个任务里就能画出「正在启动麦克风」，不会先闪一下「未录制」 */
      const settling = this.stop();
      seq = ++this._startSeq;
      this.starting = true;
      this.startingKey = key;
      return settling.then(function () {
        /* 本次启动的最新编号：后面任何一次 start/stop/换轮次都会让它作废。
           可重新取号（见 begin 里的收尾重试），所以用 let。 */
        let ticket = ++self._ticket;
        /* 从这一刻到录音器真的进入 recording 之前，界面只能显示「正在启动麦克风」，
           绝不能提前亮 REC——「权限已授予」不等于「录音已开始」。 */
        seq = ++self._startSeq;
        self.starting = true;
        self.startingKey = key;
        if (!self.supported()) { self.message = "本浏览器不支持录音。"; return false; }
        if (!self.stream) {
          /* ensure() 自己判断能不能复用上一个在途请求（旧的、已作废的不会再用） */
          const waiting = self.ensure();
          return waiting.then(function (st) { return st === "cancelled" ? false : begin(); });
        }
        return begin();

        function begin() {
          if (ticket !== self._ticket) { self.message = "旧的录音启动请求已作废。"; return false; }
          if (wantSession !== self.sessionId) { self.message = "本轮考试已开始新的阶段，旧的录音请求作废。"; return false; }
          if (!self.stream) {
            self.message = self.message || "未获得麦克风权限，本阶段不录音。";
            return false;
          }
          if (self.rec || self.isLive()) {
            /* 排队等上一阶段收尾的这段时间里，另一个（可能更晚发出的）启动请求已经把录音器
               开起来了。不先收尾就会同时挂着两个录音器：前一段的数据被新的 pending 顶掉、
               旧录音器也永远没人 stop()。收尾之后重新占号，保证本次仍是最新的一次启动。 */
            return self.stop().then(function () {
              ticket = ++self._ticket;
              return begin();
            });
          }
          self.key = key;
          self.phaseName = name || key;
          self.activeMs = 0;
          self.fallbackPaused = false;
          self.warning = "";
          try {
            if (!self._open()) { self.message = "麦克风未就绪，本阶段不录音。"; return false; }
            return true;
          } catch (e) {
            self.state = "error";
            self.key = null;
            self.pending = null;
            self.message = "录音器创建失败：" + ((e && e.name) || "未知错误") + "。考试继续，不受影响。";
            return false;
          }
        }
      }).then(function (ok) {
        /* 本次启动到此已有结论：录音器没有真正进入 recording 就不留「正在启动」状态 */
        if (self._startSeq === seq) { self.starting = false; self.startingKey = null; }
        return ok;
      });
    },

    _open() {
      const self = this;
      /* 麦克风已释放或已经没有归属阶段（换轮次、回首页、旧请求作废）时绝不启动录音器 */
      if (!this.stream || !this.key) return false;
      /* 每个录音器一条独立的分片数组，按启动顺序挂在 buffers 上。
         「停一段、续一段」的暂停兜底方案里，旧录音器可能在新录音器启动后才吐出
         最后一块；分成两条再按序拼接，避免两个录音器的数据交叉成一个坏文件。 */
      const buf = [];
      if (!this.pending || this.pending.key !== this.key) {
        this.pending = {
          key: this.key, name: this.phaseName || this.key,
          sessionId: this.sessionId, epoch: this.epoch, buffers: []
        };
      }
      this.pending.buffers.push(buf);
      const rec = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
      rec.ondataavailable = function (ev) {
        if (ev && ev.data && ev.data.size > 0) buf.push(ev.data);
      };
      rec.onerror = function (ev) {
        self.message = "录音中断：" + ((ev && ev.error && ev.error.name) || "未知错误");
      };
      this.rec = rec;
      try { if (rec.mimeType) this.mimeType = rec.mimeType; } catch (e) { /* 老浏览器无该属性 */ }
      /* 分片录制：万一浏览器崩溃或被强制刷新，已分片的数据不至于全丢 */
      rec.start(TIMESLICE_MS);
      this.meterStop();
      this.state = "recording";
      this.starting = false;
      this.startingKey = null;
      this.lastResume = Date.now();
      this.message = "正在录音 · " + this.phaseName;
      /* 等权限 / 等上一段收尾期间用户已经点过暂停：录音器一开起来就停住，不偷偷录下去 */
      if (this.pauseIntent) { this.pauseIntent = false; this.pause(); }
      return true;
    },

    /* 关闭当前录音器，等最后一块数据到齐（带兜底时限）。
       返回值如实说明结束原因，调用方据此判断这一段是否完整。 */
    _close() {
      const rec = this.rec;
      this.rec = null;
      if (!rec) return Promise.resolve("none");
      return new Promise(function (resolve) {
        let done = false;
        let timer = 0;
        const fin = function (why) {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          resolve(why);
        };
        timer = setTimeout(function () { fin("timeout"); }, CLOSE_TIMEOUT_MS);
        try {
          if (rec.state === "inactive") { fin("inactive"); return; }
          rec.onstop = function () { fin("stopped"); };
          rec.stop();
        } catch (e) { fin("error"); }
      });
    },

    /* 超时兜底之后，如果浏览器又把剩下的分片交回来了，就把那一段重拼成完整文件 */
    _watchLate(info, rec) {
      if (!rec || !info) return;
      const self = this;
      const until = Date.now() + LATE_WINDOW_MS;
      const late = function () {
        if (Date.now() > until) return;
        /* 换轮次或那一段本来就被丢弃了，就不要再把旧数据写回去 */
        if (self.sessionId !== info.sessionId || !self.data[info.key]) return;
        self._save(info, true, true);
      };
      try {
        rec.onstop = late;
        rec.ondataavailable = function (ev) {
          if (Date.now() > until) return;
          const b = info.buffers[info.buffers.length - 1];
          if (ev && ev.data && ev.data.size > 0 && b) {
            b.push(ev.data);
            /* 迟到的分片先到、onstop 还没来时也补一次，尽量不留缺口 */
            late();
          }
        };
      } catch (e) { /* 已经被回收的录音器，保持 complete:false 即可 */ }
    },

    _accumulate() {
      if (this.state === "recording" && this.lastResume) this.activeMs += Date.now() - this.lastResume;
      this.lastResume = null;
    },

    /* 把一条 pending 的分片按启动顺序拼成录音记录。
       complete:false 表示最后的数据没等到，只拿到前面分片——界面必须如实显示。
       keepUrl:true 用于晚到数据的补录：报告页可能已经拿旧 URL 在播放，不能撤销它。 */
    _save(info, complete, keepUrl) {
      const parts = [];
      for (let i = 0; i < info.buffers.length; i++) {
        const b = info.buffers[i];
        for (let j = 0; j < b.length; j++) parts.push(b[j]);
      }
      if (!parts.length) return null;
      const type = this.mimeType || (parts[0] && parts[0].type) || "audio/webm";
      let blob;
      try { blob = new Blob(parts, { type: type }); } catch (e) { return null; }
      if (!blob.size) return null;
      if (!keepUrl) this._revoke(info.key);
      let url = "";
      try { url = URL.createObjectURL(blob); } catch (e) { /* 极端情况下只剩 blob，仍可交给转写 */ }
      const rec = {
        stage: info.key,
        name: info.name || info.key,
        blob: blob,
        mimeType: blob.type || type,
        durationSeconds: Math.max(1, Math.round((info.activeMs || 0) / 1000)),
        url: url,
        savedAt: Date.now(),
        complete: !!complete,
        note: complete ? "" : "浏览器未在 " + (CLOSE_TIMEOUT_MS / 1000) + " 秒内交回最后一块数据，这段音频可能缺少结尾；后续晚到的数据会自动补进来。"
      };
      this.data[info.key] = rec;
      return rec;
    },

    /* why 来自 _close()：stopped/inactive/none 视为完整，timeout/error 视为不完整 */
    _commit(why) {
      const info = this.pending;
      this.pending = null;
      if (!info) return null;
      /* 等收尾期间已经换了轮次（换题、重来），这一段的归属已经没了，不能写进新一轮 */
      if (info.sessionId !== this.sessionId) {
        this.lastSave = { key: info.key, name: info.name || info.key, status: "cancelled", why: why };
        return null;
      }
      const complete = why !== "timeout" && why !== "error";
      info.activeMs = this.activeMs;
      const rec = this._save(info, complete);
      this.lastSave = { key: info.key, name: info.name || info.key, status: rec ? (complete ? "saved" : "timeout") : "no_data", why: why };
      if (rec && !complete) {
        this.warning = "「" + this.lastSave.name + "」未拿到最后的数据，已保留 " + mmss(rec.durationSeconds) + " 可用部分。";
      } else if (!rec) {
        this.warning = "「" + this.lastSave.name + "」没有拿到任何音频数据。";
        this.lost.push({ key: info.key, name: this.lastSave.name, reason: why === "error" ? "录音器停止时报错，未拿到任何数据" : "没有收到任何音频分片（标签页可能被浏览器挂起）" });
      } else {
        this.warning = "";
      }
      return rec;
    },

    _revoke(key) {
      const old = this.data[key];
      if (old && old.url) { try { URL.revokeObjectURL(old.url); } catch (e) {} }
    },

    /* 结束当前阶段录音并保存；没有在录就直接返回，可安全重复调用。
       无论有没有在录，都会作废仍在等权限的启动请求——否则用户在授权弹窗前
       点了「结束考试」，授权迟迟批下来时录音器会在报告页上悄悄启动。 */
    stop() {
      this._ticket++;
      this.pauseIntent = false;
      /* 启动还没落地的请求已被作废：界面立刻不再显示「正在启动麦克风」 */
      this.starting = false;
      this.startingKey = null;
      /* 同一时刻只允许一次收尾：自动切换与「结束考试」挤在一起时，
         第二次 stop() 共用第一次的结果，绝不能提前把没收完的数据当成完整保存 */
      if (this._stopping) return this._stopping;
      if (!this.isLive()) {
        const rest = this._pendingClose || null;
        this._pendingClose = null;
        if (!rest || !this.pending) return Promise.resolve(null);
        const self = this;
        this._stopping = rest.then(function () {
          const rec = self._commit("stopped");
          self._stopping = null;
          return rec;
        });
        return this._stopping;
      }
      const self = this;
      const lastRec = this.rec;
      const name = this.phaseName;
      const waiting = this._pendingClose;
      this._pendingClose = null;
      this._accumulate();
      const run = function () {
        const info = self.pending;
        return self._close().then(function (why) {
          self.fallbackPaused = false;
          const rec = self._commit(why);
          self.key = null;
          self.phaseName = name;
          /* 没等到 onstop 的那一段，之后浏览器还可能把剩余分片补回来 */
          if ((why === "timeout" || why === "error") && info) self._watchLate(info, lastRec);
          if (self.state === "recording" || self.state === "paused") {
            self.state = self.stream ? "ready" : "idle";
            self.message = self.warning || (self.stream && rec
              ? "本阶段录音已保存：" + mmss(rec.durationSeconds)
              : "录音已停止");
          }
          self._stopping = null;
          return rec;
        });
      };
      this._stopping = waiting ? waiting.then(run) : run();
      return this._stopping;
    },

    /* 计时暂停时调用。不支持 MediaRecorder.pause() 的浏览器改为「停一段、续一段」，
       分片按启动顺序分组保存，最后按序合并成一个 blob，不会交叉。 */
    pause() {
      if (this.starting) {
        /* 录音器还没起来（在等授权）：记下暂停意图，_open() 一成功就立刻停住，
           绝不能因为「点了暂停时还没在录」就让它录完整个阶段 */
        this.pauseIntent = true;
        this.message = "录音正在启动，已记下暂停：启动后保持暂停。";
        return true;
      }
      if (this.state !== "recording" || !this.pending || !this.key) return false;
      this._accumulate();
      if (this.canPause()) {
        try {
          this.rec.pause();
          this.state = "paused";
          this.message = "录音已暂停 · " + this.phaseName;
          return true;
        } catch (e) { /* 落到下面的兜底方案 */ }
      }
      this.fallbackPaused = true;
      /* 记下这一段的收尾承诺，stop() 会等它回来再拼接，避免最后一块丢在拼接之后 */
      this._pendingClose = this._close();
      this.state = "paused";
      this.message = "录音已暂停（本浏览器不支持暂停，恢复后接着录）";
      return true;
    },

    resume() {
      /* 用户改主意要接着录：撤掉「启动后保持暂停」的意图 */
      this.pauseIntent = false;
      if (this.state !== "paused" || !this.pending || !this.key) return false;
      if (this.fallbackPaused || !this.rec) {
        this.fallbackPaused = false;
        if (!this._open()) {
          this.state = "error";
          this.message = "恢复录音失败：录音器无法重新启动。";
          return false;
        }
      } else {
        try { this.rec.resume(); } catch (e) { /* 忽略：宁可少录也不要卡住考试 */ }
      }
      this.state = "recording";
      this.lastResume = Date.now();
      this.message = "正在录音 · " + this.phaseName;
      return true;
    },

    /* 当前正在录的时长（含暂停扣减），用于界面显示 */
    elapsedSeconds() {
      const extra = this.state === "recording" && this.lastResume ? Date.now() - this.lastResume : 0;
      return (this.activeMs + extra) / 1000;
    },

    /* 释放麦克风（小红点熄灭），已录好的音频保留，供报告页回放 */
    release() { return this.stopMic(); },

    _stopStream() {
      this.meterStop();
      if (!this.stream) return;
      try { this.stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); } catch (e) {}
      this.stream = null;
    },

    /* 供界面调用：只关麦克风（浏览器小红点熄灭），保留已录好的音频 */
    stopMic() {
      const self = this;
      this.epoch++;          // 之后才批下来的授权一律关掉，不把麦克风留在开着的状态
      return this.stop().then(function () {
        self._stopStream();
        if (self.state !== "denied" && self.state !== "unsupported" && self.state !== "error") {
          self.state = "idle";
          self.message = self.warning || "麦克风已关闭，录音仍保留供回放。";
        }
      });
    },

    /* 新一轮会话：只清旧录音，保留已授权的麦克风流 */
    clear() {
      const keys = Object.keys(this.data);
      for (let i = 0; i < keys.length; i++) this._revoke(keys[i]);
      this.data = Object.create(null);
      return this;
    },

    /* 作废所有在途的录音启动与授权请求（同步，立刻生效） */
    _cancelInFlight() {
      this._ticket++;
      this._startSeq++;
      this.starting = false;
      this.startingKey = null;
      this.pauseIntent = false;
      this.pending = null;
      this._pendingClose = null;
      this.key = null;
      this.activeMs = 0;
      this.lastResume = null;
      this.fallbackPaused = false;
      this.warning = "";
      this.lost = [];
    },

    /* 开始新一轮考试：轮次号 +1，上一轮遗留的异步启动请求全部作废。
       返回新轮次号，调用方（app.js）在每次 start() 时带回来做二次校验。 */
    newSession() {
      this.sessionId++;
      if (this.rec) { try { this.rec.stop(); } catch (e) {} }
      this.rec = null;
      this._cancelInFlight();
      this.clear();
      if (this.state === "recording" || this.state === "paused") {
        this.state = this.stream ? "ready" : "idle";
        this.message = this.stream ? "上一轮录音已清除，麦克风待命。" : "录音已停止";
      }
      return this.sessionId;
    },

    /* 重新开始（换题、重来一轮）：等价于 newSession()，保留旧名字给已有调用 */
    halt() { return this.newSession(); },

    /* 放弃考试 / 回首页：录音与麦克风一起释放，不等待落盘（数据本来就要丢弃） */
    discard() {
      if (this.rec) { try { this.rec.stop(); } catch (e) {} }
      this.rec = null;
      this.epoch++;
      this._cancelInFlight();
      this._stopStream();
      this.clear();
      if (this.supported() && this.state !== "denied" && this.state !== "unsupported") {
        this.state = "idle";
        this.message = "麦克风已释放，本会话录音已清除。";
      }
      return this;
    },

    /* 界面用：本轮有哪些段没拿全数据 */
    incompleteKeys() {
      const out = [];
      for (const k in this.data) if (this.data[k] && !this.data[k].complete) out.push(k);
      return out;
    },

    fileName(key, base, ext) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return (base || "tope-mate") + "-" + key + "-" +
        d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) +
        "." + (ext || extOf(this.mimeType));
    },

    /* 下载某阶段录音；浏览器不支持 a[download] 时返回 false 由调用方提示 */
    download(key, base) {
      const r = this.data[key];
      if (!r) return false;
      try {
        const a = document.createElement("a");
        a.href = r.url || URL.createObjectURL(r.blob);
        a.download = this.fileName(key, base, extOf(r.mimeType));
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 200);
        return true;
      } catch (e) { return false; }
    }
  };

  window.TOPE_Recorder = R;
})();
