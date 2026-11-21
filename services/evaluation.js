/* ───────────────── AI 评分接口（Schema 1.4.0 客户端） ─────────────────
   对接 modules/ai-scoring：POST {evaluateEndpoint}，请求与响应见
   modules/ai-scoring/docs/api_contract.md 与 docs/contracts/README.md。

   硬性约定：
     · 请求里只有转写文本，没有任何音频字节。
     · stage 必须是 B 侧键（self_intro/statement/discussion/speech/qa），
       映射表在 config/exam-config.js 的 scoringStages。
     · 只有信封校验通过（success:true + data.schemaVersion:"1.4.0"）才认为拿到真实报告；
       任何失败都返回 success:false，由页面显示失败状态，绝不回退成假分数。
     · 评分不预测人大官方等级：officialAssessment.level 必须保持 null。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var CONTRACT_VERSION = "1.4.0";
  var DIMENSIONS = ["relevance", "organization", "development", "language", "interaction", "taskCompletion", "timeManagement"];
  var B_STAGES = ["self_intro", "statement", "discussion"];
  var C_STAGES = ["speech", "qa"];
  var STATUS_BY_CODE = {
    INVALID_JSON: "bad_request", PAYLOAD_TOO_LARGE: "too_large", INVALID_REQUEST: "bad_request",
    EMPTY_TRANSCRIPT: "no_transcript", API_KEY_MISSING: "no_key", MODEL_SCHEMA_ERROR: "bad_model_output",
    PROVIDER_HTTP_ERROR: "provider", PROVIDER_TIMEOUT: "timeout", PROVIDER_NETWORK_ERROR: "provider",
    PROVIDER_BAD_RESPONSE: "bad_model_output", METHOD_NOT_ALLOWED: "bad_endpoint", NOT_FOUND: "bad_endpoint",
    /* 阿里云百炼通路新增错误码：只影响提示文案，重试与否仍以后端 error.retryable 为准。 */
    PROVIDER_AUTH_ERROR: "no_key", PROVIDER_MODEL_UNAVAILABLE: "provider", PROVIDER_CONFIG_ERROR: "bad_endpoint",
    PROVIDER_INCOMPLETE: "bad_model_output", INVALID_FIELD: "bad_request",
    INTERNAL_ERROR: "service"
  };
  var RETRYABLE = { PROVIDER_HTTP_ERROR: true, PROVIDER_TIMEOUT: true, PROVIDER_NETWORK_ERROR: true, PROVIDER_BAD_RESPONSE: true, BODY_TIMEOUT: true };

  function cfg() { return (window.TOPE_CONFIG || {}).services || {}; }
  function scoringCfg() { return (window.TOPE_CONFIG || {}).scoring || {}; }
  function endpoint() { return String(cfg().evaluateEndpoint || "").trim(); }

  /** A 内部阶段键 → Schema 1.4.0 stage；映射不到就不该发请求。 */
  function stageKey(examType, phaseKey) {
    const mapped = ((window.TOPE_CONFIG || {}).scoringStages || {})[phaseKey];
    if (!mapped) return null;
    const allowed = examType === "B" ? B_STAGES : examType === "C" ? C_STAGES : [];
    return allowed.indexOf(mapped) >= 0 ? mapped : null;
  }

  function failure(status, code, message, extra) {
    const out = {
      success: false,
      status: status,
      code: code || null,
      retryable: code ? !!RETRYABLE[code] : false,
      report: null,
      message: message
    };
    if (extra) Object.assign(out, extra);
    return out;
  }

  function str(v) { return typeof v === "string" ? v : ""; }
  function listOfStr(v) { return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; }
  function nullableScore(v) { return Number.isInteger(v) && v >= 0 && v <= 100 ? v : null; }

  /**
   * 只做「安全读取」，不改写数值含义：分数缺失就保持 null，
   * 页面据此显示「未评估」而不是 0。
   */
  function normalizeReport(data, meta, context) {
    const scores = data.scores && typeof data.scores === "object" ? data.scores : {};
    const coverage = data.scoreCoverage && typeof data.scoreCoverage === "object" ? data.scoreCoverage : {};
    const policy = data.scorePolicy && typeof data.scorePolicy === "object" ? data.scorePolicy : {};
    const feedback = Array.isArray(data.dimensionFeedback) ? data.dimensionFeedback.filter(x => x && typeof x === "object") : [];
    const feedbackByDim = {};
    for (const item of feedback) if (typeof item.dimension === "string") feedbackByDim[item.dimension] = item;
    const labels = scoringCfg().dimensionLabels || {};
    const served = DIMENSIONS.filter(k => k in scores);
    const extra = Object.keys(scores).filter(k => DIMENSIONS.indexOf(k) < 0);
    const ordered = served.concat(extra);
    return {
      success: true,
      status: "ok",
      contractVersion: str(data.schemaVersion),
      mode: str(data.mode) || "unknown",
      demoOnly: meta.demoOnly === true,
      questionId: typeof meta.questionId === "string" ? meta.questionId : null,
      examType: str(data.examType),
      stage: str(data.stage),
      stageName: context.stageName || null,
      sessionId: context.sessionId === undefined ? null : context.sessionId,
      practiceScore: nullableScore(data.practiceScore),
      scoreVersion: str(data.scoreVersion),
      scoreStatus: str(data.scoreStatus) || "not_scored",
      scorePolicy: policy,
      scoreCoverage: coverage,
      dimensions: ordered.map(key => ({
        key: key,
        label: str(labels[key]) || key,
        score: nullableScore(scores[key]),
        weight: policy.configuredWeights && typeof policy.configuredWeights[key] === "number" ? policy.configuredWeights[key] : null,
        normalizedWeight: feedbackByDim[key] && typeof feedbackByDim[key].normalizedWeight === "number" ? feedbackByDim[key].normalizedWeight : null,
        rationale: feedbackByDim[key] ? str(feedbackByDim[key].rationale) : "",
        evidenceQuotes: feedbackByDim[key] ? listOfStr(feedbackByDim[key].evidenceQuotes) : [],
        assessed: coverage.assessedDimensions ? coverage.assessedDimensions.indexOf(key) >= 0 : nullableScore(scores[key]) !== null
      })),
      overall: data.overall && typeof data.overall === "object" ? data.overall : null,
      officialAssessment: data.officialAssessment && typeof data.officialAssessment === "object" ? data.officialAssessment : null,
      rubricBasis: data.rubricBasis && typeof data.rubricBasis === "object" ? data.rubricBasis : null,
      strengths: listOfStr(data.strengths),
      weaknesses: listOfStr(data.weaknesses),
      suggestions: listOfStr(data.suggestions),
      evidence: (Array.isArray(data.evidence) ? data.evidence : []).filter(x => x && typeof x === "object").map(x => ({
        quote: str(x.quote), observation: str(x.observation), dimension: str(x.dimension)
      })),
      peel: data.peel && typeof data.peel === "object" ? data.peel : null,
      peelDetails: data.peelDetails && typeof data.peelDetails === "object" ? data.peelDetails : null,
      improvedExpressions: (Array.isArray(data.improvedExpressions) ? data.improvedExpressions : []).filter(x => x && typeof x === "object").map(x => ({
        original: str(x.original), suggested: str(x.suggested), reason: str(x.reason)
      })),
      nextPractice: listOfStr(data.nextPractice),
      unassessed: listOfStr(data.unassessed),
      diagnostics: data.diagnostics && typeof data.diagnostics === "object" ? data.diagnostics : null,
      errors: (Array.isArray(data.errors) ? data.errors : []).filter(x => x && typeof x === "object").map(x => ({ code: str(x.code), message: str(x.message) })),
      disclaimer: str(data.overall && data.overall.disclaimer) || str(policy.disclaimer),
      raw: data
    };
  }

  /** 信封与关键字段校验：不合格的报告一律不采用。 */
  function unwrap(json, context) {
    if (!json || typeof json !== "object") {
      return failure("bad_envelope", "BAD_ENVELOPE", "评分服务返回的不是约定结构，本次不采用任何分数。", context);
    }
    if (json.success === false) {
      const err = json.error || {};
      const code = str(err.code) || "SERVICE_ERROR";
      return failure(STATUS_BY_CODE[code] || "service", code,
        str(err.message) || "评分服务返回失败，但未说明原因。", Object.assign({ retryable: err.retryable === true }, context));
    }
    const data = json.data;
    if (!data || typeof data !== "object") {
      return failure("bad_envelope", "MISSING_DATA", "评分服务返回成功但没有报告内容，本次不采用任何分数。", context);
    }
    if (str(data.schemaVersion) !== CONTRACT_VERSION) {
      return failure("contract_mismatch", "SCHEMA_VERSION_MISMATCH",
        "评分服务返回的是 " + (str(data.schemaVersion) || "未知") + " 版结构，前端只接受 " + CONTRACT_VERSION + "，本次不采用任何分数。", context);
    }
    if (data.officialAssessment && data.officialAssessment.level !== null && data.officialAssessment.level !== undefined) {
      return failure("contract_mismatch", "OFFICIAL_LEVEL_PREDICTED", "评分结果包含官方等级预测，违反产品边界，本次不采用任何分数。", context);
    }
    if (data.practiceScore !== null && nullableScore(data.practiceScore) === null) {
      return failure("contract_mismatch", "BAD_PRACTICE_SCORE", "练习分不是 0–100 的整数，本次不采用任何分数。", context);
    }
    const meta = json.meta && typeof json.meta === "object" ? json.meta : {};
    return normalizeReport(data, meta, context);
  }

  const E = {
    kind: "evaluation",
    contractVersion: CONTRACT_VERSION,

    status() {
      const url = endpoint();
      return {
        configured: !!url,
        endpoint: url,
        provider: String(cfg().evaluateProvider || "").trim() || "未指定",
        requiresTranscript: cfg().requiresTranscript !== false,
        contractVersion: CONTRACT_VERSION,
        label: url ? "已配置：" + url : "尚未接入",
        message: url
          ? "已指向评分服务 " + url + "（Schema " + CONTRACT_VERSION + "）。"
          : "AI 评分服务尚未接入：报告页只会显示离线示例，不会显示你的真实分数。" +
            "接入位置为 config/exam-config.js 的 services.evaluateEndpoint，启动方式见 modules/ai-scoring/README.md。"
      };
    },

    /* A 阶段键 → 1.4.0 请求体。只带文本，不带音频。 */
    buildRequest(payload) {
      payload = payload || {};
      const stage = stageKey(payload.examType, payload.phaseKey || payload.stage);
      const request = {
        examType: payload.examType,
        stage: stage,
        question: str(payload.question).trim(),
        transcript: String(payload.transcript || ""),
        durationSeconds: typeof payload.durationSeconds === "number" && isFinite(payload.durationSeconds) ? Math.round(payload.durationSeconds * 10) / 10 : 0
      };
      if (payload.questionId) request.questionId = String(payload.questionId);
      if (typeof payload.targetDurationSeconds === "number" && payload.targetDurationSeconds > 0) {
        request.targetDurationSeconds = Math.round(payload.targetDurationSeconds);
      }
      if (scoringCfg().rubric) request.rubric = scoringCfg().rubric;
      /* 互动维度只认真实带说话人标签的轮次；没有就不传，让服务端把它留成未评估。 */
      if (stage === "discussion" && payload.assessedSpeaker && Array.isArray(payload.speakerTurns) && payload.speakerTurns.length) {
        request.assessedSpeaker = payload.assessedSpeaker;
        request.speakerTurns = payload.speakerTurns
          .filter(t => t && typeof t.speaker === "string" && typeof t.text === "string" && t.text.trim())
          .slice(0, 150)
          .map(t => ({ speaker: t.speaker, text: t.text.slice(0, 3000) }));
      }
      return request;
    },

    /**
     * 一次评分请求。signal 由调用方持有，用于离开报告页或开始新一轮考试时作废，
     * 避免过期响应覆盖新一轮结果、也避免重复点击打出多次付费请求。
     */
    requestEvaluate(payload, signal) {
      let request;
      try { request = E.buildRequest(payload); } catch (e) { return Promise.resolve(failure("bad_request", "BUILD_FAILED", "无法组装评分请求：" + e.message, { stage: payload.stage })); }
      if (!request.stage) {
        return Promise.resolve(failure("bad_request", "UNMAPPED_STAGE",
          "阶段「" + str(payload.phaseKey || payload.stage) + "」没有对应的评分阶段键，未提交请求。", { stage: payload.stage }));
      }
      if (!request.question) {
        return Promise.resolve(failure("bad_request", "MISSING_QUESTION", "缺少题目文本，未提交评分请求。", { stage: request.stage }));
      }
      if (request.transcript.length > 30000) {
        return Promise.resolve(failure("too_large", "TRANSCRIPT_TOO_LONG",
          "转写文本超过 30000 字符上限，请缩短这一阶段后再评分。", { stage: request.stage }));
      }
      const timeoutMs = (cfg().requestTimeoutMs && cfg().requestTimeoutMs.evaluate) || 150000;
      const controller = signal ? null : new AbortController();
      const usedSignal = signal || controller.signal;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const context = { stage: request.stage, stageName: payload.stageName || null, examType: request.examType, sessionId: payload.sessionId };
      return fetch(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: usedSignal
      })
        .then((res) => res.text().then((text) => ({ ok: res.ok, status: res.status, json: safeJson(text) })))
        .then((r) => {
          if (r.json === null) {
            return failure(r.status === 504 ? "timeout" : r.status === 503 ? "no_key" : r.status === 422 ? "bad_request" : "service",
              "HTTP_" + r.status, "评分服务返回了无法解析的内容（HTTP " + r.status + "），本次不采用任何分数。", context);
          }
          return unwrap(r.json, context);
        })
        .catch((err) => {
          if (err && err.name === "AbortError") {
            return failure(signal ? "cancelled" : "timeout", signal ? "CANCELLED" : "PROVIDER_TIMEOUT",
              signal ? "本次评分请求已取消。" : "评分请求超时（" + Math.round(timeoutMs / 1000) + " 秒），可以稍后重试。",
              Object.assign({ retryable: !signal }, context));
          }
          return failure("network", "NETWORK_ERROR",
            "连不上评分服务：" + ((err && err.message) || "未知错误") + "。请确认已执行 modules/ai-scoring 的 npm run serve。", context);
        })
        .finally(() => { if (timer) clearTimeout(timer); });
    },

    /* 统一入口：未配置 / 无转写文本时明确失败，绝不编造分数 */
    evaluate(payload, signal) {
      payload = payload || {};
      const st = this.status();
      const context = { stage: str(payload.stage), stageName: payload.stageName || null, examType: payload.examType, sessionId: payload.sessionId };
      if (!st.configured) return Promise.resolve(Object.assign(failure("not_configured", "NOT_CONFIGURED", st.message, context), { retryable: false }));
      if (st.requiresTranscript && !String(payload.transcript || "").trim()) {
        return Promise.resolve(Object.assign(failure("no_transcript", "EMPTY_TRANSCRIPT",
          "这一阶段还没有可用的转写文本，无法评分。可以先完成转写并检查文本，或重新录音。", context), { retryable: false }));
      }
      return this.requestEvaluate(payload, signal);
    },

    /* 只探测可达性，用于报告页显示服务是否在线。 */
    health() {
      const urls = ((window.TOPE_CONFIG || {}).services || {}).healthEndpoints || {};
      if (!urls.evaluate) return Promise.resolve({ online: false, message: "未配置评分服务地址。" });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      return fetch(urls.evaluate, { method: "GET", signal: controller.signal })
        .then((res) => res.text().then((text) => ({ res, json: safeJson(text) })))
        .then((r) => ({
          online: r.res.ok && !!r.json && r.json.success === true,
          schemaVersion: r.json && r.json.data ? str(r.json.data.schemaVersion) : "",
          mode: r.json && r.json.data ? str(r.json.data.mode) : "",
          keyConfigured: !!(r.json && r.json.data && r.json.data.aiKeyConfigured),
          message: r.res.ok ? "评分服务在线。" : "评分服务返回 HTTP " + r.res.status + "。"
        }))
        .catch(() => ({ online: false, schemaVersion: "", mode: "", keyConfigured: false, message: "评分服务未启动或无法访问。" }))
        .finally(() => clearTimeout(timer));
    },

    stageKey: stageKey
  };

  function safeJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  window.evaluateSpeech = function evaluateSpeech(args, signal) { return E.evaluate(args || {}, signal); };
  window.TOPE_Evaluation = E;
})();
