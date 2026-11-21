/* ───────────────────────── TOPE Mate 应用逻辑 ─────────────────────────
   无构建、无依赖。加载顺序：config → data → app.js
──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");
  const STORE_KEY = "tope-mate-settings-v1";

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
    const clone = JSON.parse(JSON.stringify(base));
    ["B", "C"].forEach((t) => {
      (ov[t] || []).forEach((sec, i) => {
        if (clone[t].phases[i] && typeof sec === "number" && sec > 0) clone[t].phases[i].seconds = sec;
      });
    });
    if (ov.ui) Object.assign(clone.ui, ov.ui);
    return clone;
  }

  /* ── 分类 ── */
  const CATS = window.TOPE_CATEGORIES;
  const catName = (key) => key === "all" ? "全部随机" : ((CATS.find((c) => c.key === key) || { name: "综合" }).name);

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
    report: null
  };

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
      this.handle = setInterval(() => this.tick(), Cfg.data.ui.tickIntervalMs);
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
      this.handle = setInterval(() => this.tick(), Cfg.data.ui.tickIntervalMs);
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

  const phases = () => Cfg.data[S.examType || "C"].phases;

  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  /* ── 路由 ── */
  const routes = {};
  let currentRoute = "home";

  function go(route, opts) {
    Timer.stop();
    currentRoute = route;
    renderCrumb();
    routes[route](opts || {});
    window.scrollTo(0, 0);
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
    setTimeout(() => el.remove(), ms || Cfg.data.ui.transitionMs);
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
      "</div>" +
      '<div class="alert warn mt-16"><span class="alert-ico">!</span><div><b>尚未实现</b>：语音识别、真实 AI 评分、多人实时小组讨论。当前小组讨论为单人自问自答练习模式。</div></div>' +
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
        prepareItem();
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
      " · " + esc(catName(S.category)) + "</h1><p>题目已抽出并密封，点击开始后倒计时立即启动。建议关闭手机通知，一次走完。</p></section>" +
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
      '<button class="btn primary lg" id="startExam" type="button" style="width:100%">开始考试</button>' +
      '<button class="btn ghost" id="reroll" type="button" style="width:100%">换一道题</button>' +
      '<button class="btn ghost" id="backCat" type="button" style="width:100%">返回改分类</button>' +
      "</div></div>";

    $("#startExam").onclick = () => { Sound.ensure(); startSession(); };
    $("#reroll").onclick = () => routes.brief();
    $("#backCat").onclick = () => go("category");
  };

  function totalSec(t) { return Cfg.data[t].phases.reduce((s, p) => s + p.seconds, 0); }

  function topicCardHtml(t, item) {
    if (t === "C") {
      return '<div class="card card-pad topic-card">' +
        '<div class="label">Your Topic · ' + esc(catName(item.cat)) + "</div>" +
        '<p class="topic-en">' + esc(item.en) + "</p>" +
        (Cfg.data.ui.showChineseHint ? '<p class="topic-zh">' + esc(item.zh) + "</p>" : "") +
        '<div class="row mt-16"><span class="badge brand">题号 ' + esc(item.id) + "</span>" +
        '<span class="badge">即兴演讲 3 分钟</span></div></div>';
    }
    const mine = item.cards.find((c) => c.key === S.cardKey) || item.cards[0];
    return '<div class="card card-pad topic-card">' +
      '<div class="label">Presentation Topic · ' + esc(catName(item.cat)) + "</div>" +
      '<p class="topic-en">' + esc(item.topic) + "</p>" +
      (Cfg.data.ui.showChineseHint ? '<p class="topic-zh">' + esc(item.topicZh) + "</p>" : "") +
      '<div class="row mt-16"><span class="badge accent">你的题卡：' + esc(mine.key) + "</span>" +
      '<span class="badge">' + esc(mine.point) + "</span></div>" +
      '<div class="cards3 mt-16">' + item.cards.map((c) =>
        '<div class="bcard' + (c.key === mine.key ? " mine" : "") + '"><div class="bk">Card ' + esc(c.key) + (c.key === mine.key ? " · 你的角度" : " · 队友角度") + "</div>" +
        '<div class="bp">' + esc(c.point) + '</div><div class="bpz">' + esc(c.pointZh) + "</div></div>").join("") +
      "</div></div>";
  }

  /* ───────────── 考试页 ───────────── */
  function startSession() {
    S.phaseIndex = 0;
    S.phaseLog = phases().map((p) => ({ key: p.key, name: p.name, planned: p.seconds, actual: 0, status: "pending" }));
    S.notes = "";
    S.startedAt = Date.now();
    S.finishedAt = null;
    S.report = null;
    S.qa = buildQA();
    go("exam");
    runPhase(phases()[0].seconds);
  }

  /* 专项练习可以选择不开倒计时，此时阶段就绪但不自动走表 */
  function runPhase(seconds) {
    if (S.mode === "drill" && !Cfg.data.ui.drillKeepTimers) Timer.arm(seconds);
    else Timer.start(seconds);
  }

  function buildQA() {
    const item = S.item;
    const pool = (window.TOPE_QA_SAMPLES.general || []).concat(window.TOPE_QA_SAMPLES[item.cat] || []);
    const n = Cfg.data[S.examType]["qaPrompts"] || 3;
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
      '<div><div class="pb-name">' + esc(cur.name) + '</div><div class="pb-en">' + esc(cur.en) + " · 阶段 " + (S.phaseIndex + 1) + "/" + ph.length + "</div></div>" +
      '<div class="pb-hint">' + esc(cur.hint) + "</div></div>" +
      '<div class="exam-wrap"><div>' +
      topicCardHtml(t, S.item) +
      rightPanel.main +
      "</div>" +
      '<div class="card timer-panel">' +
      '<div class="badge brand">' + esc(Cfg.data[t].label) + (drill ? " · 专项练习" : " · 完整模拟") + "</div>" +
      ringHtml() +
      '<div class="timer-state" id="timerState">进行中</div>' +
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
    const st = $("#timerState");
    if (st) st.textContent = Timer.running() ? "进行中" : (left > 0 ? "已暂停" : "本阶段结束");
    const pb = $("#pauseBtn");
    if (pb) pb.textContent = Timer.running() ? "暂停" : "继续";
  }

  function bindExamButtons() {
    $("#pauseBtn").onclick = () => {
      if (Timer.running()) { Timer.pause(); paintTimer(Timer.remainMs); }
      else { Timer.resume(); }
    };
    $("#skipBtn").onclick = () => { Timer.stop(); logPhase(S.phaseIndex, Timer.elapsedOfPhase()); advance(true); };
    $("#stopBtn").onclick = () => { Timer.stop(); logPhase(S.phaseIndex, Timer.elapsedOfPhase()); endSession(); };
    const nt = $("#newTopic");
    if (nt) nt.onclick = () => { Timer.stop(); prepareItem(); startSession(); };
  }

  function logPhase(idx, seconds) {
    const log = S.phaseLog[idx];
    if (log && log.status !== "done") { log.actual = Math.max(0, seconds); log.status = "done"; }
  }

  function advance(manual) {
    const ph = phases();
    if (S.phaseIndex >= ph.length - 1) { endSession(); return; }
    S.phaseIndex += 1;
    const next = ph[S.phaseIndex];
    Sound.next();
    if (!manual) {
      showOverlay("下一阶段", next.name, next.hint, Cfg.data.ui.transitionMs);
    }
    renderExamShell();
    runPhase(next.seconds);
  }

  function endSession() {
    Timer.stop();
    S.finishedAt = Date.now();
    Sound.end();
    S.report = buildReport();
    if (S.mode === "drill") {
      showOverlay("本题完成", "可以再来一题", "点击「查看报告」看示例反馈，或直接换题继续。", 1800);
      go("drillDone");
    } else {
      go("report");
    }
  }

  /* ───────────── 专项练习完成页 ───────────── */
  routes.drillDone = function () {
    const done = S.phaseLog;
    app.innerHTML =
      '<section class="page-head"><span class="eyebrow">' + esc(Cfg.data[S.examType].label) + " · 话题专项练习</span>" +
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
    const dims = Cfg.data.report.dimensions;
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
    const dims = Cfg.data.report.dimensions;
    const item = S.item;
    const sample = !!Cfg.data.report.isSampleData;

    app.innerHTML =
      '<section class="page-head"><span class="eyebrow">' + (sample ? "模拟报告 · Sample Report" : "模拟报告 · Report") + "</span>" +
      "<h1>" + esc(Cfg.data[S.examType].label) + " · " + esc(catName(item.cat)) + "</h1>" +
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
  };

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
          drillKeepTimers: $("#cfgDrill").checked
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
      Cfg.save(ov);
      applyWarnOverrides(ov);
      close();
      if (currentRoute === "exam" && Timer.running()) {
        toast("时长已保存，进行中的这一轮不变，下一次练习起生效");
      } else {
        toast("设置已保存");
        go(currentRoute);
      }
    };
    $("#resetCfg").onclick = () => {
      Cfg.reset();
      close();
      toast("已恢复 config/exam-config.js 的默认时长");
      go(currentRoute);
    };
  }

  /* warnAtRemaining 不走 phases 数组覆盖，单独挂回当前阶段 */
  function applyWarnOverrides(ov) {
    const ui = (ov && ov.ui) || {};
    const cs = Cfg.data.C.phases.find((p) => p.key === "speech");
    const bs = Cfg.data.B.phases.find((p) => p.key === "presentation");
    if (cs && "warnC" in ui) cs.warnAtRemaining = ui.warnC;
    if (bs && "warnB" in ui) bs.warnAtRemaining = ui.warnB;
  }

  /* ───────────── 全局事件 & 启动 ───────────── */
  $("#openSettings").onclick = openSettings;
  $("#brandHome").onclick = () => {
    if (currentRoute === "exam") {
      if (!confirm("考试计时正在进行，确定要放弃并返回首页吗？")) return;
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

  /* 数据自检：题库缺失时给出可见提示，避免白屏 */
  (function sanityCheck() {
    const problems = [];
    if (!window.TOPE_BANK_C || !window.TOPE_BANK_C.questions.length) problems.push("TOPE C 题库未加载");
    if (!window.TOPE_BANK_B || !window.TOPE_BANK_B.sets.length) problems.push("TOPE B 题库未加载");
    if (!window.TOPE_CONFIG) problems.push("考试配置未加载");
    if (problems.length) {
      app.innerHTML = '<div class="alert sample"><span class="alert-ico">!</span><div><b>资源加载失败：</b>' +
        esc(problems.join("；")) + "。请确认 index.html 中的 script 路径，并通过本地预览打开。</div></div>";
      return;
    }
    applyWarnOverrides(Cfg.overrides);
    go("home");
  })();
})();
