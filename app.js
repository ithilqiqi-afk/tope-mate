/* ───────────────────────── TOPE Mate 应用逻辑 ─────────────────────────
   无构建、无依赖。加载顺序：config → data → app.js
──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");
  const STORE_KEY = "tope-mate-settings-v1";

  /* ── 启动自检：必须在构造 Cfg / Bank 之前完成，否则缺文件时会在赋值语句里抛异常 ── */
  function missingResources() {
    const miss = [];
    const cfg = window.TOPE_CONFIG;
    if (!cfg || !cfg.B || !cfg.C) miss.push("config/exam-config.js（考试配置）");
    else {
      if (!Array.isArray(cfg.B.phases) || !cfg.B.phases.length) miss.push("config/exam-config.js 里的 B.phases");
      if (!Array.isArray(cfg.C.phases) || !cfg.C.phases.length) miss.push("config/exam-config.js 里的 C.phases");
    }
    if (!Array.isArray(window.TOPE_CATEGORIES)) miss.push("data/questions-c.js 里的 TOPE_CATEGORIES");
    if (!window.TOPE_BANK_C || !Array.isArray(window.TOPE_BANK_C.questions) || !window.TOPE_BANK_C.questions.length)
      miss.push("data/questions-c.js（TOPE C 题库）");
    if (!window.TOPE_BANK_B || !Array.isArray(window.TOPE_BANK_B.sets) || !window.TOPE_BANK_B.sets.length)
      miss.push("data/questions-b.js（TOPE B 题库）");
    if (!window.TOPE_REPORT_SAMPLES || !window.TOPE_QA_SAMPLES) miss.push("data/report-samples.js（示例报告）");
    return miss;
  }

  /* 录音模块缺失不致命：换成空实现，考试流程照常可跑 */
  if (!window.TOPE_Recorder) window.TOPE_Recorder = recorderStub();

  const missing = missingResources();
  if (missing.length) {
    app.innerHTML = '<div class="alert sample"><span class="alert-ico">!</span><div>' +
      "<b>以下文件没有加载成功，页面无法启动：</b>" + missing.join("、") +
      "。请确认文件存在、index.html 里的 script 路径正确，并重新刷新页面。" +
      '<div class="small" style="margin-top:8px">若用「双击 index.html」的方式打开而样式或功能异常，请改用「启动预览.bat」通过 localhost 打开。</div></div></div>';
    return;
  }

  /* 录音模块缺失时的空实现：保证调用点不需要到处判空，页面也不会崩 */
  function recorderStub() {
    const no = function () { return Promise.resolve(false); };
    return {
      supported: () => false, isLive: () => false, has: () => false, get: () => null,
      state: "unsupported", message: "recorder.js 未加载，录音功能不可用。",
      label: () => "录音模块未加载", mmss: (s) => String(Math.round(s || 0)),
      data: {}, warning: "", lost: [], lastSave: null, sessionId: 0,
      /* 第四版新增字段/方法：状态机与录音模块保持同一套接口，缺模块时一律「不支持」 */
      starting: false, startingKey: null, pauseIntent: false, declined: false, meterLevel: 0,
      displayState: () => "unsupported",
      meterStart: () => false, meterStop: function () {}, optOut: no,
      ensure: no, start: no, stop: () => Promise.resolve(null), pause: () => false, resume: () => false,
      release: () => Promise.resolve(), stopMic: () => Promise.resolve(),
      clear() { return this; }, halt() { return this.sessionId; }, newSession() { return this.sessionId; },
      discard() { return this; }, incompleteKeys: () => [],
      elapsedSeconds: () => 0, download: () => false, fileName: () => "tope-mate.audio"
    };
  }

  /* ── 配置：文件默认值 + 页面临时覆盖（存 localStorage） ── */
  const baseConfig = window.TOPE_CONFIG;
  const Cfg = {
    overrides: loadOverrides(),
    merged: null,
    get data() {
      if (!this.merged) this.merged = applyOverrides(baseConfig, this.overrides);
      return this.merged;
    },
    save(overrides) {
      this.overrides = overrides;
      this.merged = null;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(overrides)); } catch (e) { /* 隐私模式下忽略 */ }
    },
    reset() {
      this.overrides = {};
      this.merged = null;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
  };

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; }
  }

  function applyOverrides(base, ov) {
    const clone = normalizeConfig(JSON.parse(JSON.stringify(base)));
    ov = ov || {};
    ["B", "C"].forEach((t) => {
      if (!clone[t] || !Array.isArray(clone[t].phases)) return;
      (ov[t] || []).forEach((sec, i) => {
        if (clone[t].phases[i] && typeof sec === "number" && sec > 0) clone[t].phases[i].seconds = sec;
      });
    });
    if (ov.ui) Object.assign(clone.ui, ov.ui);
    ["B", "C"].forEach((t) => applyWarn(clone[t].phases, t === "C" ? "warnC" : "warnB", clone.ui));
    return clone;
  }

  /* 配置文件的容错：少写字段时用默认值补齐，避免页面因 undefined 抛异常 */
  function normalizeConfig(cfg) {
    cfg.ui = Object.assign({
      sound: true, showChineseHint: true, tickIntervalMs: 100,
      transitionMs: 1600, drillKeepTimers: true, recordAudio: true
    }, cfg.ui || {});
    cfg.services = cfg.services || {};
    if (!cfg.report) cfg.report = { isSampleData: true, dimensions: [] };
    ["B", "C"].forEach((t) => {
      if (!cfg[t]) return;
      cfg[t].phases = (cfg[t].phases || []).map((p) => Object.assign({ record: false, seconds: 60, name: p.key, en: p.key, hint: "" }, p));
    });
    return cfg;
  }

  /* warnAtRemaining 不属于 phases 数组覆盖范围，单独挂回陈述阶段 */
  function applyWarn(list, uiKey, ui) {
    if (!Array.isArray(list) || !ui || !(uiKey in ui)) return;
    const phase = list.find((p) => p.key === "speech" || p.key === "presentation");
    if (phase) phase.warnAtRemaining = Math.max(0, ui[uiKey] | 0);
  }

  /* ── 分类 ── */
  const CATS = window.TOPE_CATEGORIES;
  const catName = (key) => key === "all" ? "全部随机" : ((CATS.find((c) => c.key === key) || { name: "综合" }).name);

  /* ── 录音模块别名（缺失时上面已换成空实现） ── */
  const Rec = window.TOPE_Recorder;

  /* ── 题库访问 + 随机抽题（同一次会话内不重复） ── */
  const Bank = {
    cList: window.TOPE_BANK_C.questions,
    bList: window.TOPE_BANK_B.sets,
    seen: { C: new Set(), B: new Set() },

    list(type, category) {
      const src = type === "C" ? this.cList : this.bList;
      const pool = !category || category === "all" ? src : src.filter((q) => q.cat === category);
      return pool;
    },
    count(type, category) {
      return this.list(type, category).length;
    },
    draw(type, category) {
      let pool = this.list(type, category);
      if (!pool.length) pool = this.list(type, "all");
      let fresh = pool.filter((q) => !this.seen[type].has(q.id));
      if (!fresh.length) { this.seen[type].clear(); fresh = pool; }
      const picked = fresh[Math.floor(Math.random() * fresh.length)];
      this.seen[type].add(picked.id);
      return picked;
    }
  };

  /* ── 提示音（WebAudio，无需音频文件） ── */
  const Sound = {
    ctx: null,
    ensure() {
      if (this.ctx || !Cfg.data.ui.sound) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) {}
    },
    tone(freq, dur, gain) {
      if (!Cfg.data.ui.sound) return;
      this.ensure();
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = gain || 0.12;
      o.connect(g).connect(this.ctx.destination);
      const t = this.ctx.currentTime;
      o.start(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur + 0.02);
    },
    warn() { this.tone(880, 0.18, 0.1); },
    next() { this.tone(660, 0.16, 0.12); setTimeout(() => this.tone(880, 0.22, 0.12), 190); },
    end() { this.tone(520, 0.2, 0.12); setTimeout(() => this.tone(390, 0.32, 0.12), 230); }
  };

  /* ── 会话状态 ── */
  const S = {
    examType: null,
    mode: null,          // exam | drill
    category: "all",
    item: null,
    cardKey: "A",
    phaseIndex: 0,
    phaseLog: [],
    notes: "",
    qa: [],
    startedAt: null,
    finishedAt: null,
    report: null,
    ending: false,     // 防止阶段结束与提前交卷同时触发
    advancing: false,  // 防止自动切换与手动切换叠加
    /* 本轮考试启动瞬间冻结的配置快照：中途改设置只影响下一轮 */
    snap: null,
    /* 本轮录音的轮次号，传给 Recorder 用来作废旧的异步启动请求 */
    recSid: 0,
    /* 第四版：开考的启动编号。任何一次页面跳转都会让它作废，
       这样「点开始考试 → 授权弹窗挂着 → 用户已离开」不会在别的页面上突然开考并走表。 */
    launchTicket: 0,
    /* 专项练习里当前阶段正等用户手动「开始录音」：倒计时也一并等录音起来再走 */
    awaitRec: false,
    /* 本阶段用户已经明确选了「不录音，直接计时」：界面不再显示重试/待录音，只说不录音的原因 */
    noRecThisPhase: false,
    /* 考前设备检查的界面状态：idle | checking | live | ready | off | denied | error | declined | unsupported */
    devState: "idle",
    /* 「录音已开始，请作答」提示本轮已显示过的启动编号，避免同一次启动重复弹 */
    startedHintSeq: 0
  };

  /* 考试与报告一律读快照；还没开考（首页/模式/分类/考前说明/设置面板）读实时配置 */
  function sessionCfg() { return S.snap || Cfg.data; }

  /* ── 计时引擎 ──
     倒计时基于绝对截止时间（不会因 setInterval 抖动而漂移）；
     用时统计基于「累计运行时长」，暂停的时间不计入实际用时。 */
  const Timer = {
    deadline: null,
    remainMs: 0,
    handle: null,
    activeMs: 0,
    lastResume: null,
    warned: false,

    start(seconds) {
      this.stop();
      this.activeMs = 0;
      this.lastResume = Date.now();
      this.deadline = Date.now() + seconds * 1000;
      this.warned = false;
      this.handle = setInterval(() => this.tick(), sessionCfg().ui.tickIntervalMs);
      this.tick();
    },
    /* 不启动计时，只把剩余量摆好，等用户手动继续（专项练习关闭倒计时时用） */
    arm(seconds) {
      this.stop();
      this.activeMs = 0;
      this.lastResume = null;
      this.remainMs = seconds * 1000;
      this.warned = false;
      paintTimer(this.remainMs);
    },
    pause() {
      if (!this.deadline) return;
      this.activeMs += Date.now() - this.lastResume;
      this.remainMs = Math.max(0, this.deadline - Date.now());
      this.deadline = null;
      this.lastResume = null;
      clearInterval(this.handle);
      this.handle = null;
    },
    resume() {
      if (this.deadline || this.remainMs <= 0) return;
      this.lastResume = Date.now();
      this.deadline = Date.now() + this.remainMs;
      this.handle = setInterval(() => this.tick(), sessionCfg().ui.tickIntervalMs);
      this.tick();
    },
    stop() {
      clearInterval(this.handle);
      this.handle = null;
      if (this.deadline && this.lastResume) this.activeMs += Date.now() - this.lastResume;
      this.deadline = null;
      this.lastResume = null;
    },
    running() { return !!this.handle; },
    tick() {
      const left = this.deadline ? this.deadline - Date.now() : this.remainMs;
      const phase = phases()[S.phaseIndex];
      if (phase && phase.warnAtRemaining && !this.warned && left <= phase.warnAtRemaining * 1000 && left > 0) {
        this.warned = true;
        Sound.warn();
        showOverlay("注意", "陈述剩余 " + phase.warnAtRemaining + " 秒", "该收尾了：重申中心论点 + 回扣分论点。", 1400);
      }
      if (this.deadline && left <= 0) {
        const idx = S.phaseIndex;
        const planned = phase ? phase.seconds : 0;
        this.stop();
        /* 自然走完的阶段，实耗即计划时长：后台标签页被节流只会延后检测，不该记成超时 */
        logPhase(idx, planned ? Math.min(this.elapsedOfPhase(), planned) : this.elapsedOfPhase());
        if (idx === S.phaseIndex) advance();
      } else {
        paintTimer(left);
      }
    },
    elapsedOfPhase() {
      const extra = this.deadline && this.lastResume ? Date.now() - this.lastResume : 0;
      return Math.round((this.activeMs + extra) / 1000);
    }
  };

  const phases = () => sessionCfg()[S.examType || "C"].phases;

  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  /* ── 路由 ── */
  const routes = {};
  let currentRoute = "home";

  /* 麦克风与录音的生命周期：
       留在考试页 → 什么都不动（重绘不能打断录音）
       去报告 / 练习完成页 → 停止并保存当前录音，释放麦克风（关掉浏览器的小红点），保留音频供回放
       回首页 / 重新选题 → 录音与麦克风一起清空 */
  function go(route, opts) {
    opts = opts || {};
    /* 任何跳转都作废「点开始考试后还在等授权」的启动：不能让用户离开后又突然开考走表 */
    S.launchTicket++;
    S.awaitRec = false;
    if (meterTicker) { clearInterval(meterTicker); meterTicker = null; }
    if (route !== "exam") {
      if (micTicker) { clearInterval(micTicker); micTicker = null; }
      if (Rec.isLive()) Rec.stop().catch(() => {});
      /* 回首页 / 换类型 / 重新选题：录音、麦克风、旧配置快照一起丢掉 */
      if (route === "home" || route === "mode" || route === "category" || route === "brief") {
        Rec.discard();
        S.snap = null;
        S.devState = "idle";   // 麦克风已释放，设备检查结论跟着作废
      } else Rec.release();
    }
    Timer.stop();
    currentRoute = route;
    renderCrumb();
    routes[route](opts);
    window.scrollTo(0, 0);
  }

  /* 就地重绘当前页：不动计时器、不动录音。保存设置后用它，避免把暂停中的计时打断。 */
  function rerender() {
    renderCrumb();
    routes[currentRoute]({});
  }

  function renderCrumb() {
    const names = { home: "首页", mode: "模式选择", category: "话题分类", brief: "考前说明", exam: "模拟考试", drillDone: "练习完成", report: "模拟报告" };
    const parts = ["<b>TOPE Mate</b>"];
    if (S.examType && currentRoute !== "home") parts.push(S.examType === "C" ? "TOPE C" : "TOPE B");
    parts.push(names[currentRoute] || "");
    $("#crumb").innerHTML = parts.filter(Boolean).join(' <span style="opacity:.45">/</span> ');
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function showOverlay(kicker, title, sub, ms) {
    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = '<div class="box"><div class="o-phase">' + esc(kicker) + '</div><div class="o-title">' +
      esc(title) + '</div><div class="o-sub">' + esc(sub) + "</div></div>";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms || sessionCfg().ui.transitionMs);
  }

  /* ───────────── 首页 ───────────── */
  routes.home = function () {
    app.innerHTML =
      '<section class="page-head">' +
      '<span class="eyebrow">Renmin University · TOPE Speaking</span>' +
      "<h1>选择考试类型，开始一次模拟</h1>" +
      "<p>TOPE Mate 把真实的 TOPE 流程搬进浏览器：随机抽题、按阶段倒计时、自动切换环节。第一阶段先跑通「能练起来」的流程，评分反馈使用示例数据。</p>" +
      "</section>" +
      '<div class="grid grid-2">' +
      typeTile("C") + typeTile("B") +
      "</div>" +
      '<div class="card card-pad mt-24">' +
      "<h2>这个原型能做什么</h2>" +
      '<div class="grid grid-3">' +
      feature("真实流程倒计时", "C：10 分钟准备 → 3 分钟演讲 → 2 分钟问答；B：自我介绍 → 1 分钟准备 → 1.5 分钟陈述 → 小组讨论。") +
      feature("按话题分类抽题", "社会与科技、文化与传统、学习与校园、生活与人际、职业与成长，也可全部随机。") +
      feature("30 秒收尾提醒", "陈述只剩 30 秒时弹出提示并响铃，帮你练「不超时也不冷场」的节奏。") +
      feature("可修改的时长配置", "所有阶段时长集中在 config/exam-config.js，也可以在页面「考试设置」里临时调整。") +
      feature("本地题库", "C 端 196 题、B 端 22 组题卡，均来自历年真题与复习资料整理，纯本地不联网。") +
      feature("示例评分报告", "按 Content / Organization / Language / Delivery 四维给出分数与文字反馈，明确标注为示例数据。") +
      feature("分阶段麦克风录音", "演讲、问答、自我介绍、陈述、讨论各录一段，可回放、可下载，只存在本机内存。") +
      "</div>" +
      '<div class="alert ' + (Rec.supported() ? "info" : "warn") + '"><span class="alert-ico">' +
      (Rec.supported() ? "i" : "!") + "</span><div>" +
      (Rec.supported()
        ? "本浏览器支持录音（MediaRecorder 可用）。推荐使用最新版 Chrome 或 Edge，并通过「启动预览.bat」以 localhost 打开——" +
          "直接用 file:// 打开时部分浏览器会拒绝麦克风权限。"
        : "本浏览器不支持 MediaRecorder 录音，考试流程仍可正常使用。请改用最新版 Chrome 或 Edge。") +
      "</div></div>" +
      '<div class="alert warn"><span class="alert-ico">!</span><div><b>尚未实现</b>：语音转写、真实 AI 评分、多人实时小组讨论。' +
      "当前小组讨论为单人自问自答练习模式；报告页的分数与文字反馈均为本地示例数据。" +
      "转写与评分的接口位置见 services/transcription.js 与 services/evaluation.js。</div></div>" +
      "</div>";

    document.querySelectorAll("[data-type]").forEach((b) => {
      b.onclick = () => { S.examType = b.dataset.type; S.category = "all"; go("mode"); };
    });
  };

  function typeTile(t) {
    const cfg = Cfg.data[t];
    const total = t === "C" ? Bank.cList.length : Bank.bList.length;
    const flow = cfg.phases.map((p) => p.name).join(" → ");
    return '<button class="tile" data-type="' + t + '" type="button">' +
      '<div class="tile-top"><span class="tile-title">' + esc(cfg.label) + "</span>" +
      '<span class="tile-en">' + (t === "C" ? "Speech &amp; Q&amp;A" : "Presentation &amp; Discussion") + "</span></div>" +
      '<p class="tile-desc">' + esc(cfg.subtitle) + "</p>" +
      '<div class="tile-meta"><span class="badge brand">' + total + " 道题</span>" +
      '<span class="badge">' + cfg.phases.length + " 个阶段</span>" +
      '<span class="badge">' + esc(flow) + "</span></div>" +
      "</button>";
  }

  function feature(title, desc) {
    return "<div><h3>" + esc(title) + '</h3><p class="small muted" style="margin:0">' + esc(desc) + "</p></div>";
  }

  /* ───────────── 模式选择 ───────────── */
  routes.mode = function () {
    const t = S.examType;
    app.innerHTML =
      '<section class="page-head">' +
      '<span class="eyebrow">' + esc(Cfg.data[t].label) + "</span>" +
      "<h1>选择练习模式</h1>" +
      "<p>完整模拟考试会按真实顺序走完所有阶段并生成报告；话题专项练习则聚焦某一类话题，可以连续抽题反复练开头和框架。</p>" +
      "</section>" +
      '<div class="grid grid-2">' +
      modeTile("exam", "完整模拟考试", "Full Mock Test", "严格按 TOPE 流程与时长执行，结束后进入模拟报告。适合考前掐表实战。", Cfg.data[t].phases.map((p) => p.name + " " + fmt(p.seconds)).join(" · ")) +
      modeTile("drill", "话题专项练习", "Topic Drill", "只抽一个分类的题目，每道题同样带倒计时，做完可立刻换下一题。适合集中练开头与分论点。", "可反复抽题 · 随时换题 · 报告可选") +
      "</div>" +
      '<div class="row mt-24"><button class="btn ghost" id="backHome" type="button">← 换个考试类型</button></div>';

    document.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => { S.mode = b.dataset.mode; go("category"); };
    });
    $("#backHome").onclick = () => go("home");
  };

  function modeTile(key, name, en, desc, meta) {
    return '<button class="tile" data-mode="' + key + '" type="button">' +
      '<div class="tile-top"><span class="tile-title">' + esc(name) + '</span><span class="tile-en">' + esc(en) + "</span></div>" +
      '<p class="tile-desc">' + esc(desc) + "</p>" +
      '<div class="tile-meta"><span class="badge">' + esc(meta) + "</span></div></button>";
  }

  /* ───────────── 话题分类 ───────────── */
  routes.category = function () {
    const t = S.examType;
    const tiles = CATS.map((c) => {
      const n = Bank.count(t, c.key);
      return '<button class="tile" data-cat="' + c.key + '" type="button"' + (n ? "" : " disabled") + ">" +
        '<div class="tile-top"><span class="tile-title">' + esc(c.name) + '</span><span class="count-pill">' + n + " 题</span></div>" +
        '<p class="tile-desc">' + esc(c.desc) + "</p>" +
        '<div class="tile-meta"><span class="badge brand">' + esc(c.en) + "</span></div></button>";
    }).join("");

    app.innerHTML =
      '<section class="page-head">' +
      '<span class="eyebrow">' + esc(Cfg.data[t].label) + " · " + (S.mode === "exam" ? "完整模拟考试" : "话题专项练习") + "</span>" +
      "<h1>挑一个话题分类</h1>" +
      "<p>系统会从该分类的本地题库中随机抽一道题。同一轮练习内不会重复抽到已出过的题目。</p>" +
      "</section>" +
      '<div class="grid grid-3">' + tiles +
      '<button class="tile" data-cat="all" type="button"><div class="tile-top"><span class="tile-title">全部随机</span>' +
      '<span class="count-pill">' + Bank.count(t, "all") + " 题</span></div>" +
      '<p class="tile-desc">不限分类，从整个题库随机抽取，最接近真实考场体验。</p>' +
      '<div class="tile-meta"><span class="badge accent">推荐</span></div></button>' +
      "</div>" +
      '<div class="row mt-24"><button class="btn ghost" id="backMode" type="button">← 返回模式选择</button></div>';

    document.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => {
        S.category = b.dataset.cat;
        if (S.mode === "exam") { go("brief"); return; }
        /* 专项练习不在这里抢权限：进页后由用户自己点「开始录音」（那一下才是用户手势），
           或者点「不录音，直接计时」，练习页不会一进去就弹授权框。 */
        prepareItem();
        Sound.ensure();
        startSession();
      };
    });
    $("#backMode").onclick = () => go("mode");
  };

  /* 抽题并分配题卡角度 */
  function prepareItem() {
    S.item = Bank.draw(S.examType, S.category);
    if (S.examType === "B") S.cardKey = "ABC"[Math.floor(Math.random() * 3)];
    S.report = null;
    return S.item;
  }

  /* ───────────── 考前说明（完整模拟） ───────────── */
  routes.brief = function () {
    const t = S.examType;
    prepareItem();
    const item = S.item;
    const recorded = Cfg.data.ui.recordAudio
      ? Cfg.data[t].phases.filter((p) => p.record).map((p) => p.name)
      : [];

    const rules = t === "C"
      ? ["准备室门口签到后开始 10 分钟准备，可以带纸质字典，不允许使用手机。",
         "准备时间结束后进入教室做 3 分钟即兴演讲，剩余 30 秒会有提醒。",
         "演讲结束后进入 2 分钟问答，由中教与外教各提问，回答要完整，不要只说 Yes / No。",
         "评分更看重结构清晰：开头—主体—结尾三段式必须明显，缺结构扣分很重。"]
      : ["三人一组，先各做约 40 秒自我介绍。",
         "拿到题卡后有 1 分钟准备，只允许在草稿纸上记关键词，不能写在卡片上。",
         "每人 1.5 分钟个人陈述，需围绕卡片上的角度展开，开篇点题、结尾复述。",
         "随后 5 分钟小组讨论，无准备时间；原型阶段按单人自问自答练习。"];

    app.innerHTML =
      '<section class="page-head"><span class="eyebrow">考前说明</span><h1>' + esc(Cfg.data[t].label) +
      " · " + esc(catName(S.category)) + "</h1><p>题目已抽出并密封。点「开始考试」后准备倒计时才起表；" +
      "如果浏览器要问麦克风权限，这段时间不扣准备时间（" +
      (t === "C" ? "TOPE C 保证完整 " : "TOPE B 保证完整 ") +
      fmt(Cfg.data[t].phases[0].seconds) + ' 准备时间）。建议关闭手机通知，一次走完。</p></section>' +
      '<div class="exam-wrap"><div>' +
      topicCardHtml(t, item) +
      '<div class="card card-pad mt-16"><h2>考试流程</h2><ul class="tips">' +
      rules.map((r) => "<li>" + esc(r) + "</li>").join("") +
      "</ul></div>" +
      '<div class="card card-pad mt-16"><h2>阶段与时长</h2><table class="data"><thead><tr><th>阶段</th><th>时长</th><th>要点</th></tr></thead><tbody>' +
      Cfg.data[t].phases.map((p) => "<tr><td>" + esc(p.name) + "</td><td class=\"num\">" + fmt(p.seconds) + "</td><td>" + esc(p.hint) + "</td></tr>").join("") +
      "</tbody></table><p class='small muted mt-16'>时长可在右上角「考试设置」或直接编辑 config/exam-config.js 修改。</p></div>" +
      "</div>" +
      '<div class="card timer-panel">' +
      '<div class="badge brand">准备就绪</div>' +
      '<div style="text-align:center"><div class="time-text">' + fmt(totalSec(t)) + "</div><div class=\"time-sub\">全流程总时长</div></div>" +
      deviceCheckHtml() +
      micNoticeHtml(recorded) +
      '<button class="btn primary lg" id="startExam" type="button" style="width:100%">开始考试</button>' +
      '<div id="launchNote"></div>' +
      '<button class="btn ghost" id="reroll" type="button" style="width:100%">换一道题</button>' +
      '<button class="btn ghost" id="backCat" type="button" style="width:100%">返回改分类</button>' +
      "</div></div>";

    $("#startExam").onclick = launchSession;
    $("#reroll").onclick = () => {
      /* 换题不清麦克风：只停掉采样，检查结论仍然有效 */
      Rec.meterStop();
      if (S.devState === "live") S.devState = micStreamLive() ? "ready" : "idle";
      routes.brief();
    };
    $("#backCat").onclick = () => go("category");
    $("#devCheck").onclick = runDeviceCheck;
    $("#devOff").onclick = () => {
      S.devState = "off";
      Rec.stopMic().then(paintDeviceCheck);   // 关掉小红点，已检查过的权限仍然记住
    };
    $("#devNoMic").onclick = () => {
      Rec.optOut().then(() => { S.devState = "declined"; paintDeviceCheck(); toast("已切换到不录音模式，考试照常计时。"); });
    };
    paintDeviceCheck();
  };

  /* ── 考前设备检查：只测电平，不建录音器，声音不会存成考试答案、也进不了评分流程 ── */
  function deviceCheckHtml() {
    return '<div class="dev-box" id="devBox">' +
      '<div class="dev-head"><span class="dev-title">考前设备检查</span><span class="dev-state" id="devState">未检查</span></div>' +
      '<div class="meter-row" id="devMeter" hidden>' +
      '<div class="meter"><div class="meter-fill" id="meterBar"></div></div>' +
      '<div class="meter-val" id="meterVal">对着麦克风说一句话试试</div></div>' +
      '<div class="mic-note" id="devNote"></div>' +
      '<div class="row" style="width:100%;gap:8px">' +
      '<button class="btn sm" id="devCheck" type="button" style="flex:1">检查麦克风</button>' +
      '<button class="btn sm ghost" id="devOff" type="button" style="flex:1" hidden>关闭麦克风</button>' +
      "</div>" +
      '<button class="btn sm ghost" id="devNoMic" type="button" hidden>不用麦克风，只计时</button>' +
      "</div>";
  }

  const DEV_TEXT = {
    idle: ["未检查", "点「检查麦克风」试一下设备能不能出声。不检查也能直接开始考试，浏览器会在那一刻才问权限，这段时间不扣准备时间。"],
    checking: ["正在等待授权…", "浏览器弹窗还没点的话，这一步可以一直等——倒计时还没起表，准备时间不会被占用。"],
    live: ["麦克风已就绪", "对着麦克风说一句话，下面的格子跟着动就说明设备真的收到声音。检查用的音频不会保存，也不会送去评分。"],
    ready: ["麦克风已就绪", "已拿到权限。"],
    off: ["麦克风已关闭", "设备已释放（浏览器小红点熄灭）。权限已经记住，点「开始考试」不用再点一次弹窗。"],
    denied: ["权限被拒绝", "可以在浏览器地址栏的锁/麦克风图标里改成「允许」，然后点「重新检查」。也可以选「不用麦克风」：考试照常计时，但没有音频、无法做语音评分。"],
    error: ["设备不可用", ""],
    declined: ["已选择不用麦克风", "本次只计时、不录音，报告里的语音部分仍是示例数据。想改回来点「检查麦克风」即可。"],
    unsupported: ["本浏览器不支持", "请改用最新版 Chrome / Edge，或用「启动预览.bat」通过 localhost 打开。考试计时不受影响。"]
  };

  function paintDeviceCheck() {
    if (!$("#devBox")) return;
    const t = S.examType;
    const st = S.devState || "idle";
    const txt = DEV_TEXT[st] || DEV_TEXT.idle;
    $("#devState").textContent = txt[0];
    $("#devState").className = "dev-state " + (st === "live" || st === "ready" ? "ok" : st === "denied" || st === "error" || st === "unsupported" ? "bad" : st === "checking" ? "wait" : "");
    let note = txt[1];
    if (st === "ready") note = "已拿到麦克风权限，点「开始考试」后准备倒计时从 " + fmt(Cfg.data[t].phases[0].seconds) + " 起表。";
    if (st === "error") note = (Rec.message || "麦克风获取失败。") + " 可以点「重新检查」再试，或选「不用麦克风」继续计时。";
    $("#devNote").innerHTML = esc(note) + (st === "live" || st === "ready" ? '<br><span class="small muted">提示：戴着耳机最稳妥，外放提示音可能被录进答案开头。</span>' : "");
    const sampling = st === "live";
    $("#devMeter").hidden = !sampling;
    $("#devCheck").textContent = st === "denied" || st === "error" ? "重新检查" : st === "declined" ? "改用麦克风" : "检查麦克风";
    $("#devOff").hidden = !(st === "live" || st === "ready");
    $("#devNoMic").hidden = st === "declined" || st === "unsupported" || !Cfg.data.ui.recordAudio;
    if (!Cfg.data.ui.recordAudio) {
      $("#devState").textContent = "录音开关已关闭";
      $("#devNote").textContent = "「考试设置」里把录音打开就能检查麦克风；本次只计时。";
      $("#devCheck").hidden = $("#devOff").hidden = $("#devNoMic").hidden = true;
    } else {
      $("#devCheck").hidden = st === "unsupported";
    }
    syncMeterTicker();
    if (sampling) paintMeter();
  }

  /* 必须在点击事件的同步调用栈里发起 getUserMedia，才带得上用户手势 */
  function runDeviceCheck() {
    if (!Rec.supported()) { S.devState = "unsupported"; paintDeviceCheck(); return; }
    const t = S.devState;
    /* 已经就绪时再点一次 = 重新起采样，方便再确认音量 */
    if (t === "ready" || t === "live") {
      S.devState = Rec.meterStart() ? "live" : "ready";
      paintDeviceCheck();
      return;
    }
    S.devState = "checking";
    paintDeviceCheck();
    const p = Rec.ensure();
    p.then((st) => {
      if (currentRoute !== "brief") return;   // 期间已离开本页
      if (st === "ready") S.devState = Rec.meterStart() ? "live" : "ready";
      else if (st === "cancelled") S.devState = "idle";
      else if (st === "unsupported") S.devState = "unsupported";
      else S.devState = st === "denied" ? "denied" : "error";
      paintDeviceCheck();
    });
  }

  function micNoticeHtml(recorded) {
    if (!Cfg.data.ui.recordAudio)
      return '<div class="mic-notice off">录音开关已关闭（考试设置里可打开），本次不录制音频。</div>';
    if (!recorded.length)
      return '<div class="mic-notice off">当前配置没有任何阶段开启录音。</div>';
    return '<div class="mic-notice"><b>将录制 ' + esc(recorded.join("、")) + "</b><br>" +
      "录音只存在本机内存，可回放和下载，不上传。<br>" +
      "不录音也能正常计时，只是没有音频、无法做语音评分。</div>";
  }

  /* 麦克风当前是否真的还开着（已授权且轨道没结束） */
  function micStreamLive() {
    return !!(Rec.stream && Rec.stream.getAudioTracks &&
      Rec.stream.getAudioTracks().some((t) => t.readyState === "live"));
  }

  /* 开始考试：getUserMedia 必须在点击事件的同步调用栈里发出，才带得上用户手势。
     授权没有结论之前绝不能起表——否则等弹窗的这几十秒会把准备时间吃掉。 */
  function launchSession() {
    Sound.ensure();
    const t = S.examType;
    const wantRec = Cfg.data.ui.recordAudio && Cfg.data[t].phases.some((p) => p.record);
    /* 不录音 / 已明确不用麦克风 / 浏览器不支持 / 检查过且麦克风还开着：没有要等的东西，立刻开考 */
    if (!wantRec || Rec.declined || !Rec.supported() || micStreamLive()) {
      startSession();
      if (wantRec && (Rec.declined || !Rec.supported())) {
        toast("按「不录音」开始：只计时，报告里的语音反馈仍是示例数据。");
      }
      return;
    }
    const ticket = ++S.launchTicket;
    const btn = $("#startExam");
    if (btn) { btn.disabled = true; btn.textContent = "等待麦克风授权…（倒计时未启动）"; }
    S.devState = "checking";
    paintDeviceCheck();
    const note = $("#launchNote");
    if (note) note.innerHTML = '<div class="mic-notice wait">准备倒计时还没起表，这一段时间不计入 ' +
      fmt(Cfg.data[t].phases[0].seconds) + ' 准备时间。<button class="btn sm ghost" id="launchNoMic" type="button">不等了，直接开始（不录音）</button></div>';
    const p = Rec.ensure();
    if ($("#launchNoMic")) $("#launchNoMic").onclick = () => {
      if (ticket !== S.launchTicket) return;
      Rec.optOut().then(() => {
        if (ticket !== S.launchTicket) return;
        startSession();
        toast("已按「不录音」开始：只计时，报告里的语音反馈仍是示例数据。");
      });
    };
    p.then((st) => {
      if (ticket !== S.launchTicket || currentRoute !== "brief") return;  // 期间已离开/已另起
      if (btn) { btn.disabled = false; btn.textContent = "开始考试"; }
      if (note) note.innerHTML = "";
      if (st === "ready") { S.devState = "ready"; startSession(); return; }
      if (st === "cancelled") { S.devState = "idle"; paintDeviceCheck(); return; }
      /* 被拒 / 出错 / 不支持：照样开考，但把话说清楚——只计时，没有音频 */
      S.devState = st === "denied" ? "denied" : st === "unsupported" ? "unsupported" : "error";
      startSession();
      toast(st === "denied"
        ? "麦克风权限被拒绝：考试照常计时，本阶段不录音，也无法做语音评分。"
        : (Rec.message || "麦克风不可用：考试照常计时，不录音。"));
    });
  }

  function totalSec(t) { return Cfg.data[t].phases.reduce((s, p) => s + p.seconds, 0); }

  function topicCardHtml(t, item) {
    if (t === "C") {
      return '<div class="card card-pad topic-card">' +
        '<div class="label">Your Topic · ' + esc(catName(item.cat)) + "</div>" +
        '<p class="topic-en">' + esc(item.en) + "</p>" +
        (sessionCfg().ui.showChineseHint ? '<p class="topic-zh">' + esc(item.zh) + "</p>" : "") +
        '<div class="row mt-16"><span class="badge brand">题号 ' + esc(item.id) + "</span>" +
        '<span class="badge">即兴演讲 3 分钟</span></div></div>';
    }
    const mine = item.cards.find((c) => c.key === S.cardKey) || item.cards[0];
    return '<div class="card card-pad topic-card">' +
      '<div class="label">Presentation Topic · ' + esc(catName(item.cat)) + "</div>" +
      '<p class="topic-en">' + esc(item.topic) + "</p>" +
      (sessionCfg().ui.showChineseHint ? '<p class="topic-zh">' + esc(item.topicZh) + "</p>" : "") +
      '<div class="row mt-16"><span class="badge accent">你的题卡：' + esc(mine.key) + "</span>" +
      '<span class="badge">' + esc(mine.point) + "</span></div>" +
      '<div class="cards3 mt-16">' + item.cards.map((c) =>
        '<div class="bcard' + (c.key === mine.key ? " mine" : "") + '"><div class="bk">Card ' + esc(c.key) + (c.key === mine.key ? " · 你的角度" : " · 队友角度") + "</div>" +
        '<div class="bp">' + esc(c.point) + '</div><div class="bpz">' + esc(c.pointZh) + "</div></div>").join("") +
      "</div></div>";
  }

  /* ───────────── 考试页 ───────────── */
  function startSession() {
    /* 启动瞬间冻结配置：之后在「考试设置」里改时长只影响下一轮，
       进行中的这一轮连阶段名称、剩余比例、提醒秒数都不会被改掉 */
    S.snap = JSON.parse(JSON.stringify(Cfg.data));
    S.phaseIndex = 0;
    S.phaseLog = phases().map((p) => ({ key: p.key, name: p.name, planned: p.seconds, actual: 0, status: "pending" }));
    S.notes = "";
    S.startedAt = Date.now();
    S.finishedAt = null;
    S.report = null;
    S.ending = false;
    S.advancing = false;
    S.qa = buildQA();
    S.recSid = Rec.newSession();   // 新一轮不继承上一轮的录音，旧轮次的异步启动请求一律作废
    go("exam");
    runPhase(phases()[0].seconds);
  }

  /* 专项练习可以选择不开倒计时，此时阶段就绪但不自动走表 */
  function runPhase(seconds) {
    const ph = phases()[S.phaseIndex];
    /* 专项练习里要录音的阶段由用户决定什么时候开录：没开录之前这一阶段的倒计时也不走 */
    S.noRecThisPhase = false;
    if (S.mode === "drill" && Cfg.data.ui.recordAudio && ph && ph.record && !Rec.declined) {
      S.awaitRec = true;
      Timer.arm(seconds);
      paintMic();
      return;
    }
    S.awaitRec = false;
    startPhaseRecording(ph);
    if (S.mode === "drill" && !sessionCfg().ui.drillKeepTimers) Timer.arm(seconds);
    else Timer.start(seconds);
  }

  /* 按阶段的 record 开关决定是否录音；失败只提示，绝不影响计时。
     录音开关读实时配置（中途关掉要立刻生效），时长等其它项读本轮快照。 */
  function startPhaseRecording(phase) {
    if (!Cfg.data.ui.recordAudio || !phase || !phase.record) return;
    const sid = S.recSid, idx = S.phaseIndex;
    const starting = Promise.resolve(Rec.start(phase.key, phase.name, sid));
    paintMic();   // 启动请求已经挂上：立刻显示「正在启动麦克风」，不要等结果
    starting
      .then((ok) => {
        paintMic();
        if (sid !== S.recSid || idx !== S.phaseIndex || currentRoute !== "exam") return;
        /* 只有录音器确实进入 recording 才提示「请作答」，权限批下来但没开录不算 */
        if (ok) announceRecordingStart(phase);
        else if (Rec.state === "denied") toast("本阶段无法录音：" + Rec.message);
      })
      .catch((e) => { Rec.state = "error"; Rec.message = "录音异常：" + ((e && e.message) || e); paintMic(); });
  }

  /* 专项练习：用户点「开始录音」——录音真的起来之后才给这一阶段起表 */
  function startDrillRecording(withAudio) {
    const ph = phases()[S.phaseIndex];
    if (!ph) return;
    const sid = S.recSid, idx = S.phaseIndex;
    if (!withAudio) {
      /* 明确不录音，直接按配置开始计时 */
      S.awaitRec = false;
      S.noRecThisPhase = true;
      if (sessionCfg().ui.drillKeepTimers) Timer.start(ph.seconds); else Timer.arm(ph.seconds);
      paintTimer(Timer.deadline ? Timer.deadline - Date.now() : Timer.remainMs);
      paintMic();
      toast("已按不录音开始这一阶段：只计时，没有音频，也无法做语音评分。");
      return;
    }
    S.awaitRec = false;
    paintMic();
    /* 授权请求尽量放在点击的同步调用栈里发起（Recorder 内部会复用这一次请求） */
    if (!micStreamLive() && !Rec.declined) Rec.ensure();
    const starting = Promise.resolve(Rec.start(ph.key, ph.name, sid));
    paintMic();   // 同样先画出「正在启动麦克风」
    starting
      .then((ok) => {
        if (sid !== S.recSid || idx !== S.phaseIndex || currentRoute !== "exam") { paintMic(); return; }
        if (ok) {
          if (sessionCfg().ui.drillKeepTimers) Timer.start(ph.seconds); else Timer.arm(ph.seconds);
          announceRecordingStart(ph);
        } else {
          S.awaitRec = true;   // 没起来：按钮回到「开始录音」，也可以选不录音直接计时
          toast(Rec.message || "录音没有启动：可以再点一次「开始录音」，或选「不录音，直接计时」。");
        }
        paintMic();
      })
      .catch((e) => {
        S.awaitRec = true;
        Rec.state = "error";
        Rec.message = "录音启动异常：" + ((e && e.message) || e);
        paintMic();
        toast(Rec.message);
      });
  }

  /* 录音器确认进入 recording 之后的提示：不重置计时，也不重复执行阶段 */
  function announceRecordingStart(phase) {
    S.startedHintSeq++;
    toast("录音已开始，请作答 · " + phase.name);
    paintMic();
  }

  function buildQA() {
    const item = S.item;
    const pool = (window.TOPE_QA_SAMPLES.general || []).concat(window.TOPE_QA_SAMPLES[item.cat] || []);
    const n = sessionCfg()[S.examType]["qaPrompts"] || 3;
    const shuffled = pool.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
    if (S.examType === "B" && item.followUps) {
      const mine = item.followUps.find((f) => f.key === S.cardKey) || item.followUps[0];
      return [mine.q].concat(shuffled);
    }
    return shuffled;
  }

  routes.exam = function () {
    renderExamShell();
  };

  function renderExamShell() {
    const t = S.examType;
    const ph = phases();
    const cur = ph[S.phaseIndex];
    const isLast = S.phaseIndex === ph.length - 1;
    const drill = S.mode === "drill";

    const stepper = ph.map((p, i) => {
      const cls = i < S.phaseIndex ? "done" : i === S.phaseIndex ? "active" : "";
      const mark = i < S.phaseIndex ? "✓" : i + 1;
      return '<span class="step ' + cls + '"><span class="dot">' + mark + "</span>" + esc(p.name) + "</span>" +
        (i < ph.length - 1 ? '<span class="step-line"></span>' : "");
    }).join("");

    const bannerCls = Timer.warned && cur.warnAtRemaining ? "warn" : "";
    const rightPanel = sidePanelHtml(t, cur);

    app.innerHTML =
      '<div class="steps">' + stepper + "</div>" +
      '<div class="phase-banner ' + bannerCls + '" id="phaseBanner">' +
      '<div><div class="pb-name">' + esc(cur.name) + (ph[S.phaseIndex].record ? '<span class="rec-flag" id="recFlag" hidden></span>' : "") +
      '</div><div class="pb-en">' + esc(cur.en) + " · 阶段 " + (S.phaseIndex + 1) + "/" + ph.length + "</div></div>" +
      '<div class="pb-hint">' + esc(cur.hint) + "</div></div>" +
      '<div class="exam-wrap"><div>' +
      topicCardHtml(t, S.item) +
      rightPanel.main +
      "</div>" +
      '<div class="card timer-panel">' +
      '<div class="badge brand">' + esc(sessionCfg()[t].label) + (drill ? " · 专项练习" : " · 完整模拟") + "</div>" +
      ringHtml() +
      '<div class="timer-state" id="timerState">进行中</div>' +
      micBoxHtml() +
      '<div class="row" style="width:100%;gap:8px">' +
      '<button class="btn" id="pauseBtn" type="button" style="flex:1">暂停</button>' +
      '<button class="btn" id="skipBtn" type="button" style="flex:1">结束本阶段</button>' +
      "</div>" +
      (drill ? '<button class="btn" id="newTopic" type="button" style="width:100%">换一题重练</button>' : "") +
      '<button class="btn danger" id="stopBtn" type="button" style="width:100%">' + (isLast ? "结束并查看报告" : "提前结束考试") + "</button>" +
      '<ul class="phase-list" style="width:100%">' +
      ph.map((p, i) => {
        const log = S.phaseLog[i];
        const cls = i < S.phaseIndex ? "done" : i === S.phaseIndex ? "active" : "";
        const taken = log && log.status === "done" ? '<span class="pl-taken">实耗 ' + fmt(log.actual) + "</span>" : "";
        return '<li class="' + cls + '"><span class="pl-name">' + esc(p.name) + "</span>" + taken + '<span class="pl-time">' + fmt(p.seconds) + "</span></li>";
      }).join("") +
      "</ul></div></div>";

    rightPanel.bind();
    bindExamButtons();
    paintTimer(Timer.deadline ? Timer.deadline - Date.now() : Timer.remainMs);
    paintMic();
  }

  function sidePanelHtml(t, cur) {
    if (cur.key === "prepare") {
      return {
        main:
          '<div class="card card-pad mt-16"><h2>提纲草稿纸</h2>' +
          '<p class="small muted">原型阶段只保存本地，刷新页面会清空。想留档可以复制到自己的笔记里。</p>' +
          '<textarea class="note-area" id="noteArea" placeholder="Introduction（逐字写好）&#10;· Hook:&#10;· Central idea:&#10;&#10;Body&#10;· Point 1 + example&#10;· Point 2 + example&#10;&#10;Conclusion（重申 + 回扣）"></textarea></div>',
        bind: () => {
          const ta = $("#noteArea");
          ta.value = S.notes;
          ta.oninput = () => { S.notes = ta.value; };
          ta.focus();
        }
      };
    }
    if (cur.key === "qa") {
      return {
        main: '<div class="card card-pad mt-16"><h2>考官提问（示例题库）</h2>' +
          '<div class="alert info"><span class="alert-ico">i</span><div>第一阶段为本地随机追问模板，未接入真实 AI 听辨你的演讲内容。</div></div>' +
          '<ul class="tips">' + S.qa.map((q) => "<li>" + esc(q) + "</li>").join("") + "</ul></div>",
        bind: () => {}
      };
    }
    if (t === "B" && cur.key === "discussion") {
      return {
        main: '<div class="card card-pad mt-16"><h2>小组讨论题</h2>' +
          '<p class="topic-en" style="font-size:19px">' + esc(S.item.discussion) + "</p>" +
          '<p class="topic-zh">' + esc(S.item.discussionZh) + "</p>" +
          '<div class="alert warn mt-16"><span class="alert-ico">!</span><div>原型阶段为<b>单人自问自答</b>：先复述题目，再依次扮演 A / B / C 各表一次态。多人实时小组讨论留待后续版本。</div></div>' +
          "<h3>讨论功能句备用</h3><ul class='tips'>" +
          "<li>So today our discussion's topic is ...</li>" +
          "<li>Thank you for sharing your opinion. I'd like to add ...</li>" +
          "<li>We haven't heard B's viewpoint yet — could B share?</li>" +
          "<li>To sum up, some of us think ... while others ...</li></ul></div>",
        bind: () => {}
      };
    }
    if (t === "B" && cur.key === "intro") {
      const si = window.TOPE_BANK_B.selfIntro;
      return {
        main: '<div class="card card-pad mt-16"><h2>自我介绍要求</h2>' +
          '<p class="small">' + esc(si.requirement) + "</p><p class=\"topic-zh\">" + esc(si.requirementZh) + "</p>" +
          '<ul class="tips mt-16">' + si.outline.map((o) => "<li>" + esc(o) + "</li>").join("") + "</ul></div>",
        bind: () => {}
      };
    }
    if (cur.key === "presentation" || cur.key === "speech") {
      return {
        main: '<div class="card card-pad mt-16"><h2>演讲检查清单</h2><ul class="tips">' +
          "<li>开头 30–40 秒：引入 + 过渡句 + 明确中心论点</li>" +
          "<li>主体 2–3 个分论点：观点句 + 具体例子 + 一句分析</li>" +
          "<li>连接词要出声：Let's start with... / Then we move on to...</li>" +
          "<li>结尾：To summarize... 重申中心论点并回扣开头</li>" +
          "<li>剩 30 秒提醒响起时，立刻进结尾，不要开新论点</li></ul>" +
          '<p class="small muted mt-16">草稿纸内容已保留，可切回准备阶段查看。</p></div>',
        bind: () => {}
      };
    }
    return { main: "", bind: () => {} };
  }

  function ringHtml() {
    return '<div class="ring" id="ring"><svg viewBox="0 0 200 200">' +
      '<circle class="track" cx="100" cy="100" r="84"></circle>' +
      '<circle class="bar" id="ringBar" cx="100" cy="100" r="84"></circle></svg>' +
      '<div class="ring-inner"><div><div class="time-text" id="timeText">--:--</div>' +
      '<div class="time-sub" id="timeSub">剩余时间</div></div></div></div>';
  }

  const RING_C = 2 * Math.PI * 84;

  /* 倒计时面板里的录音状态块 */
  function micBoxHtml() {
    return '<div class="mic-box" id="micBox">' +
      '<div class="mic-head"><span class="mic-dot off" id="micDot"></span>' +
      '<span class="mic-state" id="micState">未录制</span>' +
      '<span class="rec-pill" id="recPill" hidden>REC</span>' +
      '<span class="mic-time" id="micTime">00:00</span></div>' +
      '<div class="rec-hint" id="recHint" hidden>录音已开始，请作答</div>' +
      '<div class="mic-note" id="micNote"></div>' +
      '<div class="row" style="width:100%;gap:8px">' +
      '<button class="btn sm primary" id="recStart" type="button" hidden style="flex:1">开始录音</button>' +
      '<button class="btn sm ghost" id="recNoMic" type="button" hidden style="flex:1">不录音，直接计时</button>' +
      '<button class="btn sm ghost" id="recMicOn" type="button" hidden style="flex:1">改用麦克风</button>' +
      "</div>" +
      '<button class="btn sm" id="micRetry" type="button" hidden>授权 / 重试录音</button>' +
      "</div>";
  }

  /* 醒目的录音状态：只有录音器确实在跑才亮 REC */
  function paintRecFlag(text) {
    const flag = $("#recFlag");
    if (!flag) return;
    const on = Rec.displayState() === "recording";
    flag.hidden = !on;
    if (on) flag.textContent = text || "● REC 录音中 " + Rec.mmss(Rec.elapsedSeconds());
  }

  function paintMic() {
    if (!$("#micBox")) return;
    const ph = phases()[S.phaseIndex];
    const want = !!Cfg.data.ui.recordAudio && !!(ph && ph.record);
    /* displayState() 只把「录音器真的在跑」算作 recording：权限刚批下来时是 starting */
    const view = Rec.displayState();
    const live = view === "recording";
    const held = view === "paused";
    const booting = view === "starting";
    const noMic = view === "declined";
    const bad = view === "denied" || view === "error" || view === "unsupported";
    const saved = (Rec.get(ph && ph.key) || {}).durationSeconds || 0;
    const dot = $("#micDot");
    dot.className = "mic-dot " + (live ? "live" : booting ? "boot" : held ? "held" : bad ? "bad" : "off");
    const state = $("#micState");
    const skipped = S.noRecThisPhase && !live && !held;
    state.textContent = !Cfg.data.ui.recordAudio ? "录音已关闭"
      : !want ? (live || held ? "录音已关闭" : "本阶段不录音")
      : skipped ? "本阶段不录音"
      : Rec.label(view);
    /* 该录却没录起来的几种情况按用户的说法直写「录音未启动」，具体原因在下面的说明里 */
    if (want && !skipped && !live && !held && !booting && view === "error") state.textContent = "录音未启动";
    const pill = $("#recPill");
    pill.hidden = !live;
    const hint = $("#recHint");
    hint.hidden = !live;
    $("#micTime").textContent = Rec.mmss(live || held ? Rec.elapsedSeconds() : saved);
    const note = $("#micNote");
    if (!Cfg.data.ui.recordAudio) note.textContent = "需要录音请在「考试设置」里打开录音开关。";
    else if (!ph) note.textContent = "";
    else if (!ph.record) note.textContent = "按配置，" + ph.name + "不录音频（提纲阶段保持安静）。";
    else if (live) note.textContent = "正在录制「" + ph.name + "」，音频只存本机内存，不上传。";
    else if (booting) note.textContent = "正在启动麦克风：录音器还没开始收数据，界面不会提前显示录音中。";
    else if (held) note.textContent = "计时暂停，录音同步暂停，点「继续」后接着录同一文件。";
    else if (noMic) note.textContent = Rec.message || "已选择不用麦克风：只计时，不录音，也无法做语音评分。";
    else if (bad) note.textContent = Rec.message;
    else if (skipped) note.textContent = "你选了「不录音，直接计时」：这一阶段没有音频，也无法做真实语音评分。想改回来点下方按钮即可。";
    else if (S.awaitRec && want) note.textContent = "这一阶段等你点「开始录音」；点下去之后录音和倒计时同时起，之前不会偷录。";
    else if (view === "pending") note.textContent = "等待你在浏览器弹窗里允许使用麦克风…";
    else if (want && !live && !held) note.textContent = "本阶段应当录音但未开始，可点下方按钮重试。";
    else note.textContent = Rec.message || "麦克风待命。";
    /* 上一段没等到最后一块数据时如实说明，不要让用户以为已经完整保存 */
    if (!live && !held && Rec.warning) note.textContent += "（" + Rec.warning + "）";
    /* 专项练习：手动开录的两个入口，随时可以改成不录音只计时 */
    const manual = S.awaitRec && want && !live && !held && currentRoute === "exam";
    $("#recStart").hidden = !manual || noMic;
    $("#recNoMic").hidden = !manual || noMic;
    $("#recMicOn").hidden = !(want && noMic);
    const retry = $("#micRetry");
    retry.hidden = !(want && !live && !held && !booting && !noMic && !S.awaitRec && view !== "pending");
    paintRecFlag();
    syncMicTicker();
  }

  /* 关闭倒计时的专项练习里计时器不走，录音时长用这个低频刷新 */
  let micTicker = null;
  function syncMicTicker() {
    const need = currentRoute === "exam" && Rec.displayState() === "recording" && !Timer.running();
    if (need && !micTicker) micTicker = setInterval(paintMic, 500);
    if (!need && micTicker) { clearInterval(micTicker); micTicker = null; }
  }

  /* 设备检查的音量电平刷新（只在考前说明页用） */
  let meterTicker = null;
  function syncMeterTicker() {
    const meter = $("#devMeter");
    const need = currentRoute === "brief" && !!meter && !meter.hidden;
    if (need && !meterTicker) meterTicker = setInterval(paintMeter, 100);
    if (!need && meterTicker) { clearInterval(meterTicker); meterTicker = null; }
  }

  function paintMeter() {
    const bar = $("#meterBar"), num = $("#meterVal");
    if (!bar) return;
    /* 用 Recorder 里同一份采样值，界面只负责画出来 */
    const lv = Math.max(0, Math.min(1, (Rec.meterLevel || 0) * 1.35));
    bar.style.width = Math.round(lv * 100) + "%";
    bar.className = "meter-fill" + (lv > 0.06 ? " on" : "");
    if (num) num.textContent = lv > 0.06 ? "有声音输入" : "没有检测到声音";
  }

  function paintTimer(msLeft) {
    const timeText = $("#timeText");
    if (!timeText) return;
    const ph = phases()[S.phaseIndex];
    if (!ph) return;
    const left = Math.max(0, msLeft) / 1000;
    timeText.textContent = fmt(left);
    const bar = $("#ringBar");
    const ring = $("#ring");
    const ratio = ph.seconds ? Math.min(1, Math.max(0, left / ph.seconds)) : 0;
    bar.style.strokeDasharray = RING_C;
    bar.style.strokeDashoffset = RING_C * (1 - ratio);
    ring.classList.remove("warn", "danger");
    if (ph.warnAtRemaining && left <= ph.warnAtRemaining) ring.classList.add("danger");
    else if (left <= 30) ring.classList.add("warn");
    /* 横幅配色跟着倒计时走，不然提醒响起时只有圆环变色 */
    const bn = $("#phaseBanner");
    if (bn) {
      bn.classList.remove("warn", "danger");
      if (ph.warnAtRemaining && left <= ph.warnAtRemaining) bn.classList.add("danger");
      else if (left <= 30) bn.classList.add("warn");
    }
    const st = $("#timerState");
    if (st) st.textContent = S.awaitRec ? "等待开始录音" : Timer.running() ? "进行中" : (left > 0 ? "已暂停" : "本阶段结束");
    const pb = $("#pauseBtn");
    if (pb) pb.textContent = Timer.running() ? "暂停" : "继续";
    const view = Rec.displayState();
    const mt = $("#micTime");
    if (mt && (view === "recording" || view === "paused")) mt.textContent = Rec.mmss(Rec.elapsedSeconds());
    paintRecFlag();
  }

  function bindExamButtons() {
    $("#pauseBtn").onclick = () => {
      /* 专项练习等录音的那一下：先让用户明确「开始录音」或「不录音，直接计时」，
         不然按「继续」把倒计时偷偷起表，就和录音对不上了 */
      if (S.awaitRec && !Timer.running()) {
        toast("先点「开始录音」（录音与倒计时同时起），或点「不录音，直接计时」。");
        return;
      }
      if (Timer.running()) { Timer.pause(); syncRecordingPause(); }
      else { Timer.resume(); syncRecordingResume(); }
      paintTimer(Timer.deadline ? Timer.deadline - Date.now() : Timer.remainMs);
      paintMic();
    };
    $("#skipBtn").onclick = () => { Timer.stop(); logPhase(S.phaseIndex, Timer.elapsedOfPhase()); advance(true); };
    $("#stopBtn").onclick = () => {
      Timer.stop();
      logPhase(S.phaseIndex, Timer.elapsedOfPhase());
      /* 必须等录音数据落盘之后再进报告页，否则最后一段会没有音频 */
      Rec.stop().catch(() => {}).then(() => { if (!S.ending) endSession(); });
    };
    const nt = $("#newTopic");
    if (nt) nt.onclick = () => { Timer.stop(); logPhase(S.phaseIndex, Timer.elapsedOfPhase()); prepareItem(); startSession(); };
    const retry = $("#micRetry");
    if (retry) retry.onclick = retryRecording;
    const rs = $("#recStart");
    if (rs) rs.onclick = () => startDrillRecording(true);
    const rn = $("#recNoMic");
    if (rn) rn.onclick = () => startDrillRecording(false);
    const rm = $("#recMicOn");
    if (rm) rm.onclick = () => {
      /* 同样要在点击的同步调用栈里发起授权 */
      const p = Rec.ensure();
      const sid = S.recSid, idx = S.phaseIndex;
      p.then((st) => {
        paintMic();
        if (st !== "ready") { toast(Rec.message); return; }
        toast("麦克风已就绪" + (S.awaitRec ? "，正在开始录音" : "，下一阶段会自动录音"));
        if (S.awaitRec && sid === S.recSid && idx === S.phaseIndex && currentRoute === "exam") startDrillRecording(true);
      });
    };
  }

  /* 计时暂停/恢复时同步录音状态 */
  function syncRecordingPause() { try { Rec.pause(); } catch (e) {} }
  function syncRecordingResume() { try { Rec.resume(); } catch (e) {} }

  /* 权限被拒或录音未启动时，在考试页就地重试 */
  function retryRecording() {
    const ph = phases()[S.phaseIndex];
    if (!ph || !ph.record) return;
    const sid = S.recSid, idx = S.phaseIndex, key = ph.key;
    const asking = Rec.ensure();
    paintMic();   // 授权请求已发出：先显示「等待授权」
    asking.then((st) => {
      paintMic();
      /* 授权弹窗挂着的时候用户已经跳过了这个阶段：不要替它重启录音 */
      if (currentRoute !== "exam" || sid !== S.recSid || idx !== S.phaseIndex || phases()[S.phaseIndex].key !== key) {
        toast("阶段已切换，未重启录音");
        return null;
      }
      if (st !== "ready") { toast(Rec.message); return null; }
      /* 同一阶段只允许一个录音器：先收尾再重开 */
      return Rec.start(ph.key, ph.name, sid);
    }).then((ok) => {
      paintMic();
      if (ok) announceRecordingStart(phases()[S.phaseIndex]);
    }).catch((e) => {
      Rec.state = "error";
      Rec.message = "录音重试失败：" + ((e && e.message) || e);
      paintMic();
      toast(Rec.message);
    });
  }

  function logPhase(idx, seconds) {
    const log = S.phaseLog[idx];
    if (log && log.status !== "done") { log.actual = Math.max(0, seconds); log.status = "done"; }
  }

  /* 切换到下一阶段。录音数据落盘之后才进下一阶段或报告页，
     这样上一阶段的音频不会被下一段录音覆盖，也不会丢在报告页之外。 */
  function advance(manual) {
    if (S.advancing || S.ending) return;
    const ph = phases();
    const isLast = S.phaseIndex >= ph.length - 1;
    S.advancing = true;
    Rec.stop().catch(() => null).then(() => {
      S.advancing = false;
      if (isLast) { endSession(); return; }
      S.phaseIndex += 1;
      const next = ph[S.phaseIndex];
      Sound.next();
      if (!manual) showOverlay("下一阶段", next.name, next.hint, sessionCfg().ui.transitionMs);
      renderExamShell();
      runPhase(next.seconds);
    });
  }

  function endSession() {
    if (S.ending) return;
    S.ending = true;
    Timer.stop();
    Rec.stop().catch(() => null).then(() => {
      S.finishedAt = Date.now();
      Sound.end();
      S.report = buildReport();
      S.ending = false;
      if (S.mode === "drill") {
        showOverlay("本题完成", "可以再来一题", "点击「查看报告」看示例反馈，或直接换题继续。", 1800);
        go("drillDone");
      } else {
        go("report");
      }
    });
  }

  /* ───────────── 专项练习完成页 ───────────── */
  routes.drillDone = function () {
    const done = S.phaseLog;
    app.innerHTML =
      '<section class="page-head"><span class="eyebrow">' + esc(sessionCfg()[S.examType].label) + " · 话题专项练习</span>" +
      "<h1>这一题练完了</h1><p>题目：" + esc(S.examType === "C" ? S.item.en : S.item.topic) + "</p></section>" +
      '<div class="card card-pad"><h2>本阶段实际用时</h2><table class="data"><thead><tr><th>阶段</th><th>计划</th><th>实际</th><th>差值</th></tr></thead><tbody>' +
      done.map((p) => {
        const diff = p.actual - p.planned;
        const diffText = diff === 0 ? "准点" : (diff > 0 ? "超 " : "少 ") + Math.abs(diff) + " 秒";
        return "<tr><td>" + esc(p.name) + "</td><td class=\"num\">" + fmt(p.planned) + "</td><td class=\"num\">" + fmt(p.actual) + "</td><td class=\"num\">" + diffText + "</td></tr>";
      }).join("") +
      "</tbody></table></div>" +
      '<div class="row mt-24">' +
      '<button class="btn primary lg" id="again" type="button">再来一题（同分类）</button>' +
      '<button class="btn lg" id="viewReport" type="button">查看示例报告</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn ghost" id="toHome" type="button">回首页</button></div>';

    $("#again").onclick = () => { prepareItem(); startSession(); };
    $("#viewReport").onclick = () => go("report");
    $("#toHome").onclick = () => go("home");
  };

  /* ───────────── 报告（示例数据） ───────────── */
  function seedFrom(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  function buildReport() {
    const rnd = seedFrom(S.item.id + "|" + S.examType + "|" + Math.floor((S.startedAt || 0) / 60000));
    const dims = sessionCfg().report.dimensions;
    const speechLog = S.phaseLog.find((p) => p.key === "speech" || p.key === "presentation");
    const planned = speechLog ? speechLog.planned : 180;
    const actual = speechLog ? speechLog.actual : planned;
    const ratio = planned ? Math.min(1.1, actual / planned) : 1;

    const scores = {};
    dims.forEach((d) => {
      let base = 62 + rnd() * 32;
      if (d.key === "content" || d.key === "organization") base += (ratio - 1) * 40;
      if (d.key === "delivery") base += (ratio - 1) * 25;
      scores[d.key] = Math.max(45, Math.min(96, Math.round(base)));
    });
    const overall = Math.round(dims.reduce((s, d) => s + scores[d.key] * d.weight, 0));

    const pick = (pool, v) => pool.find((x) => v >= x.min) || pool[pool.length - 1];
    const dimDetail = {};
    dims.forEach((d) => {
      const pool = window.TOPE_REPORT_SAMPLES.dimensions[d.key] || [];
      dimDetail[d.key] = pick(pool, scores[d.key]);
    });

    const weakest = dims.slice().sort((a, b) => scores[a.key] - scores[b.key])[0];
    const stepPool = window.TOPE_REPORT_SAMPLES.nextSteps[weakest.key] || [];
    const nextStep = stepPool[Math.floor(rnd() * stepPool.length)] || stepPool[0];

    return {
      overall: overall,
      band: pick(window.TOPE_REPORT_SAMPLES.overall, overall).label,
      bandText: pick(window.TOPE_REPORT_SAMPLES.overall, overall).text,
      scores: scores,
      dimDetail: dimDetail,
      weakest: weakest,
      nextStep: nextStep,
      ratio: ratio,
      duration: S.finishedAt && S.startedAt ? Math.round((S.finishedAt - S.startedAt) / 1000) : 0
    };
  }

  routes.report = function () {
    const r = S.report || (S.report = buildReport());
    const dims = sessionCfg().report.dimensions;
    const item = S.item;
    const sample = !!sessionCfg().report.isSampleData;

    app.innerHTML =
      '<section class="page-head"><span class="eyebrow">' + (sample ? "模拟报告 · Sample Report" : "模拟报告 · Report") + "</span>" +
      "<h1>" + esc(sessionCfg()[S.examType].label) + " · " + esc(catName(item.cat)) + "</h1>" +
      '<p class="small muted">' + esc(S.examType === "C" ? item.en : item.topic) + "</p></section>" +
      (sample ? '<div class="alert sample"><span class="alert-ico">示例</span><div>' + esc(window.TOPE_REPORT_SAMPLES.disclaimer) + "</div></div>" : "") +
      '<div class="score-hero card card-pad">' +
      '<div class="score-big"><div class="n">' + r.overall + '</div><div class="l">' + (sample ? "示例综合分 / 100" : "综合分 / 100") + '</div><div class="band">' + esc(r.band) + "</div></div>" +
      "<div><h2>总体判断</h2><p>" + esc(r.bandText) + "</p>" +
      '<div class="row"><span class="badge brand">陈述完成度 ' + Math.round(r.ratio * 100) + "%</span>" +
      '<span class="badge">全流程用时 ' + fmt(r.duration) + "</span>" +
      '<span class="badge">最弱项：' + esc(r.weakest.name) + "</span></div></div></div>" +
      '<div class="card card-pad mt-16"><h2>分项得分</h2>' +
      dims.map((d) => {
        const v = r.scores[d.key];
        const cls = v < 70 ? "low" : v < 85 ? "mid" : "";
        const note = r.dimDetail[d.key];
        return '<div class="dim-row"><div class="dim-name">' + esc(d.name) + "<small>" + esc(d.en) + " · 权重 " + Math.round(d.weight * 100) + "%</small></div>" +
          '<div class="dim-score">' + v + '</div><div class="bar"><span class="' + cls + '" style="width:' + v + '%"></span></div>' +
          '<div class="dim-note">' + esc(v >= 85 ? "亮点：" + note.good : "改进：" + note.bad) + "</div></div>";
      }).join("") +
      "</div>" +
      '<div class="grid grid-2 mt-16">' +
      '<div class="card card-pad"><h2>下一步怎么练</h2><p>' + esc(r.nextStep) + "</p>" +
      '<div class="alert info"><span class="alert-ico">i</span><div>本条建议按「得分最低的维度」从本地模板中挑选，不是 AI 对你语音的分析结果。</div></div></div>' +
      '<div class="card card-pad"><h2>本次实际用时（真实记录）</h2>' +
      '<table class="data"><thead><tr><th>阶段</th><th>计划</th><th>实际</th></tr></thead><tbody>' +
      S.phaseLog.map((p) => "<tr><td>" + esc(p.name) + '</td><td class="num">' + fmt(p.planned) + '</td><td class="num">' + fmt(p.actual) + "</td></tr>").join("") +
      "</tbody></table><p class='small muted mt-16'>用时数据来自本次会话的真实计时。</p></div></div>" +
      '<div class="card card-pad mt-16"><h2>题目回顾</h2>' + topicCardHtml(S.examType, item) + "</div>" +
      recordingsCardHtml() +
      aiPipelineCardHtml() +
      '<div class="row mt-24">' +
      '<button class="btn primary lg" id="again" type="button">再练一次同分类</button>' +
      '<button class="btn lg" id="changeCat" type="button">换个话题分类</button>' +
      '<span class="spacer"></span><button class="btn ghost" id="toHome" type="button">回首页</button></div>';

    $("#again").onclick = () => {
      prepareItem();
      if (S.mode === "exam") go("brief");
      else startSession();
    };
    $("#changeCat").onclick = () => go("category");
    $("#toHome").onclick = () => go("home");
    bindReportAudio();
  };

  /* ───────────── 录音回放（报告页） ───────────── */
  function recordablePhases() {
    return phases().filter((p) => p.record);
  }

  function fileBase() {
    return "tope" + (S.examType || "c").toLowerCase() + "-" + (S.item ? S.item.id : "x");
  }

  function kb(bytes) {
    return bytes > 1024 ? (bytes / 1024).toFixed(0) + " KB" : bytes + " B";
  }

  function recordingsCardHtml() {
    const list = recordablePhases();
    let head = '<div class="card card-pad mt-16"><h2>录音回放</h2>';
    if (!sessionCfg().ui.recordAudio) {
      return head + '<div class="alert warn"><span class="alert-ico">!</span><div>录音开关当前是关闭状态，' +
        "本次没有录制任何音频。可在右上角「考试设置」里打开「开启麦克风录音」后重新开始。</div></div></div>";
    }
    if (!list.length) {
      return head + '<p class="small muted">配置里没有任何阶段开启录音（config/exam-config.js 各阶段的 record 字段）。</p></div>';
    }
    const rows = list.map((p) => {
      const r = Rec.get(p.key);
      if (!r) {
        const lost = (Rec.lost || []).filter((x) => x.key === p.key)[0];
        const why = lost ? lost.reason
          : Rec.declined ? "已选择「不用麦克风」：本次只计时，没有录音，也无法做真实语音评分"
          : Rec.state === "denied" ? "麦克风权限被拒绝"
          : Rec.state === "unsupported" ? "浏览器不支持录音"
          : Rec.state === "error" ? "麦克风不可用" : "没有产生音频数据";
        return '<div class="rec-item none"><div class="rec-head"><span class="rec-name">' + esc(p.name) + "</span>" +
          '<span class="badge">未录制</span></div><div class="small muted">' + esc(why) +
          "。转写与真实语音评分都需要这段音频，可在考试页的录音块里重试。</div></div>";
      }
      const bad = r.complete === false;
      return '<div class="rec-item"><div class="rec-head"><span class="rec-name">' + esc(p.name) + "</span>" +
        '<span class="badge ' + (bad ? "accent" : "ok") + '">' + (bad ? "数据未完整 " : "已录制 ") + Rec.mmss(r.durationSeconds) + "</span>" +
        '<span class="badge">' + esc(r.stage) + "</span></div>" +
        (bad ? '<div class="small rec-err">' + esc(r.note) + "</div>" : "") +
        '<audio class="rec-audio" controls preload="metadata" data-stage="' + esc(p.key) + '" src="' + esc(r.url) + '"></audio>' +
        '<div class="rec-foot"><span class="small muted">' + esc(r.mimeType || "audio") + " · " + kb(r.blob.size) +
        " · " + esc(Rec.fileName(p.key, fileBase(), (r.mimeType || "").indexOf("webm") >= 0 ? "webm" : "audio")) + "</span>" +
        '<span class="spacer"></span><button class="btn sm" data-dl="' + esc(p.key) + '" type="button">下载录音</button>' +
        '<span class="rec-err small" data-err="' + esc(p.key) + '"></span></div></div>';
    }).join("");
    const got = list.filter((p) => Rec.get(p.key)).length;
    const partial = list.filter((p) => { const r = Rec.get(p.key); return r && r.complete === false; }).length;
    return head + '<div class="alert info"><span class="alert-ico">i</span><div>本次共 ' + got + " / " + list.length +
      " 个阶段有录音" + (partial ? "，其中 " + partial + " 段没等到浏览器交回最后一块数据，已保留可用部分（见下方标注）" : "") +
      "。音频只存在这台电脑的内存里，不上传、不写盘，刷新页面即消失；下载得到的文件可以留档或发给同学互评。</div></div>" +
      rows + "</div>";
  }

  /* 转写与 AI 评分：只报接入状态，没有真实结果就明说，绝不伪造 */
  function aiPipelineCardHtml() {
    const tr = (window.TOPE_Transcription || { status: () => ({ label: "尚未接入", message: "services/transcription.js 未加载。" }) }).status();
    const ev = (window.TOPE_Evaluation || { status: () => ({ label: "尚未接入", message: "services/evaluation.js 未加载。" }) }).status();
    const rows = recordablePhases().map((p) => {
      const r = Rec.get(p.key);
      return "<tr><td>" + esc(p.name) + "</td>" +
        "<td>" + (r ? "已录 " + Rec.mmss(r.durationSeconds) + (r.complete === false ? " · 未完整" : "") : "无音频") + "</td>" +
        '<td><span class="badge ' + (tr.configured ? "ok" : "accent") + '">' + esc(tr.label) + "</span></td>" +
        '<td><span class="badge ' + (ev.configured ? "ok" : "accent") + '">' + esc(ev.label) + "</span></td></tr>";
    }).join("");
    return '<div class="card card-pad mt-16"><h2>语音转写与 AI 评分</h2>' +
      '<div class="alert sample"><span class="alert-ico">未接入</span><div>' +
      "本页上方的分数与文字反馈全部来自本地示例模板，<b>不是</b>对你录音的分析结果。" +
      esc(tr.message) + " " + esc(ev.message) + "</div></div>" +
      '<table class="data"><thead><tr><th>阶段</th><th>录音</th><th>转写</th><th>评分</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      '<p class="small muted mt-16">对接位置：services/transcription.js 的 transcribeAudio() 与 services/evaluation.js 的 evaluateSpeech()；' +
      "后端地址填在 config/exam-config.js 的 services 段。API Key 只应存在于后端。</p></div>";
  }

  function bindReportAudio() {
    app.querySelectorAll("[data-dl]").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.dl;
        if (Rec.download(key, fileBase())) { toast("已开始下载：" + Rec.fileName(key, fileBase())); return; }
        const r = Rec.get(key);
        if (r && r.url) { window.open(r.url, "_blank"); toast("浏览器不支持直接下载，已在新标签打开，可右键另存"); }
        else toast("这段录音已失效，请重新练习");
      };
    });
    app.querySelectorAll("audio[data-stage]").forEach((a) => {
      const hint = app.querySelector('[data-err="' + a.dataset.stage + '"]');
      a.onerror = () => {
        if (hint) hint.textContent = "本浏览器无法回放该格式，请下载后用其他播放器打开。";
        a.style.display = "none";
      };
    });
  }

  /* ───────────── 设置面板 ───────────── */
  function openSettings() {
    const cur = Cfg.data;
    const warnItem = (t, label, phase) =>
      '<div class="cfg-item"><label>' + esc(label) + '</label><input type="number" min="0" step="5" id="cfgWarn' + t + '" value="' +
      ((phase && phase.warnAtRemaining) || 0) + '"><div class="unit">秒，0 表示不提醒</div></div>';
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML =
      '<div class="modal"><div class="modal-head"><h2>考试设置</h2><button class="x-btn" id="closeCfg" type="button">×</button></div>' +
      '<div class="modal-body">' +
      '<div class="alert info"><span class="alert-ico">i</span><div>这里的修改只保存在当前浏览器，用于临时缩短时间做快速练习。要永久修改请编辑 <code>config/exam-config.js</code>。</div></div>' +
      (S.snap
        ? '<div class="alert warn"><span class="alert-ico">!</span><div>本轮考试用的是开始时的时长快照' +
          "（" + esc(S.examType) + "：" + phases().map((p) => p.name + " " + fmt(p.seconds)).join(" · ") + "）。" +
          "保存后只会影响下一场考试，进行中的这一轮不变；录音开关例外，它立即生效。</div></div>"
        : "") +
      ["C", "B"].map((t) =>
        "<h3 class=\"mt-16\">" + esc(cur[t].label) + " · " + esc(cur[t].subtitle) + '</h3><div class="cfg-grid">' +
        cur[t].phases.map((p, i) =>
          '<div class="cfg-item"><label>' + esc(p.name) + '</label><input type="number" min="5" step="5" value="' + p.seconds + '" data-t="' + t + '" data-i="' + i + '"><div class="unit">秒（默认 ' + cur[t].phases[i].seconds + "）</div></div>"
        ).join("") + "</div>"
      ).join("") +
      '<h3 class="mt-16">提醒与显示</h3>' +
      '<div class="switch-row"><span>阶段结束与 30 秒提醒响铃</span><input type="checkbox" id="cfgSound"' + (cur.ui.sound ? " checked" : "") + "></div>" +
      '<div class="switch-row"><span>题目下方显示中文提示</span><input type="checkbox" id="cfgZh"' + (cur.ui.showChineseHint ? " checked" : "") + "></div>" +
      '<div class="switch-row"><span>专项练习也使用倒计时</span><input type="checkbox" id="cfgDrill"' + (cur.ui.drillKeepTimers ? " checked" : "") + "></div>" +
      '<div class="switch-row"><span>开启麦克风录音<span class="small muted">（各阶段是否录音由 config 里的 record 决定）</span></span>' +
      '<input type="checkbox" id="cfgRec"' + (cur.ui.recordAudio ? " checked" : "") + "></div>" +
      '<div class="alert warn mt-16"><span class="alert-ico">!</span><div>录音只保存在本机内存，不上传、不写盘。关闭开关会立即停止正在进行的录音。</div></div>' +
      '<h3 class="mt-16">陈述阶段剩余多少秒时提醒</h3><div class="cfg-grid">' +
      warnItem("C", "TOPE C · 3 分钟演讲", cur.C.phases.find((p) => p.key === "speech")) +
      warnItem("B", "TOPE B · 个人陈述", cur.B.phases.find((p) => p.key === "presentation")) +
      "</div></div>" +
      '<div class="modal-foot"><button class="btn ghost" id="resetCfg" type="button">恢复文件默认值</button>' +
      '<button class="btn primary" id="saveCfg" type="button">保存设置</button></div></div>';
    document.body.appendChild(mask);

    const close = () => mask.remove();
    $("#closeCfg").onclick = close;
    mask.onclick = (e) => { if (e.target === mask) close(); };

    $("#saveCfg").onclick = () => {
      const ov = {
        C: [], B: [],
        ui: {
          sound: $("#cfgSound").checked,
          showChineseHint: $("#cfgZh").checked,
          drillKeepTimers: $("#cfgDrill").checked,
          recordAudio: $("#cfgRec").checked
        }
      };
      mask.querySelectorAll("input[type=number][data-t]").forEach((inp) => {
        const t = inp.dataset.t, i = +inp.dataset.i;
        ov[t][i] = Math.max(5, parseInt(inp.value, 10) || 0);
      });
      const wc = parseInt($("#cfgWarnC").value, 10);
      const wb = parseInt($("#cfgWarnB").value, 10);
      if (!isNaN(wc)) ov.ui.warnC = Math.max(0, wc);
      if (!isNaN(wb)) ov.ui.warnB = Math.max(0, wb);
      const wasRecording = Rec.isLive();
      Cfg.save(ov);
      close();
      /* 关掉录音开关时立刻收尾，别让麦克风继续录一个界面上显示「不录音」的阶段 */
      if (wasRecording && !ov.ui.recordAudio) {
        Rec.stopMic().catch(() => null).then(() => paintMic());
      }
      const examLive = currentRoute === "exam" || currentRoute === "report" || currentRoute === "drillDone";
      if (currentRoute === "exam") {
        /* 考试进行中：只就地重绘，不能走 go()——那会 Timer.stop() 打断暂停中的计时，也会动到录音 */
        rerender();
        toast(wasRecording && !ov.ui.recordAudio
          ? "设置已保存；录音已停止，本段音频仍可在报告页回放"
          : "设置已保存；时长从下一轮练习开始生效，进行中的这一轮不变");
        return;
      }
      toast("设置已保存");
      if (examLive) rerender();
      else go(currentRoute);
    };
    $("#resetCfg").onclick = () => {
      Cfg.reset();
      close();
      toast("已恢复 config/exam-config.js 的默认时长");
      if (currentRoute === "exam") rerender();
      else go(currentRoute);
    };
  }

  /* ───────────── 全局事件 & 启动 ───────────── */
  $("#openSettings").onclick = openSettings;
  $("#brandHome").onclick = () => {
    if (currentRoute === "exam") {
      if (!confirm("考试计时正在进行，确定要放弃并返回首页吗？\n本轮已录制的音频会一并清除。")) return;
      Timer.stop();
    }
    go("home");
  };

  document.addEventListener("keydown", (e) => {
    if (currentRoute !== "exam" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); $("#pauseBtn").click(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#skipBtn").click(); }
  });

  window.addEventListener("beforeunload", (e) => {
    if (currentRoute === "exam" && Timer.running()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* 资源自检已提到文件开头；这里只负责真正启动页面 */
  Cfg.merged = null;
  go("home");
})();
