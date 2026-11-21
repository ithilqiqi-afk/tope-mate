/* ───────────────────────── AI 评分接口（预留） ─────────────────────────
   本文件只定义接口与返回结构，当前没有接入任何真实评分服务。
   页面里的评分报告仍然来自 data/report-samples.js 的本地示例数据，
   并明确标注为「示例数据」，不会伪装成 AI 分析结果。

   接入方式（成员 B 提供的评分服务）：
     1. 后端地址填进 config/exam-config.js 的 services.evaluateEndpoint，
        填写后本模块状态由「尚未接入」变为「已配置」，页面才会真的发请求。
     2. 期望后端返回下方 normalize() 里的字段结构；字段名不同时在 normalize() 映射。
     3. 评分维度（rubric）直接取 config/exam-config.js 的 report.dimensions，
        与 A 端界面共用同一份定义，改一处即可。

   安全约定：API Key 只放后端，前端 JavaScript 里不得出现密钥。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const EMPTY = {
    overallScore: null,
    dimensionScores: [],
    strengths: [],
    weaknesses: [],
    suggestions: [],
    improvedExamples: []
  };

  function services() {
    const cfg = window.TOPE_CONFIG || {};
    return cfg.services || {};
  }

  function rubric(examType) {
    const cfg = (window.TOPE_CONFIG || {}).report;
    return {
      examType: examType || "",
      scale: [0, 100],
      dimensions: (cfg && cfg.dimensions) || []
    };
  }

  const E = {
    kind: "evaluation",

    /* 评分能力的接入状态 */
    status() {
      const s = services();
      const endpoint = String(s.evaluateEndpoint || "").trim();
      return {
        configured: !!endpoint,
        endpoint: endpoint,
        provider: String(s.evaluateProvider || "").trim() || "未指定",
        requiresTranscript: s.requiresTranscript !== false,
        label: endpoint ? "已配置：" + endpoint : "尚未接入",
        message: endpoint
          ? "已指向评分服务 " + endpoint + "，返回结果将替换报告页的示例评分。"
          : "AI 评分服务尚未接入：报告页的分数与文字反馈全部来自本地示例模板，" +
            "与你的实际语音无关。接入位置为 config/exam-config.js 的 services.evaluateEndpoint。"
      };
    },

    buildRequest(payload) {
      payload = payload || {};
      return {
        examType: payload.examType || "",
        question: payload.question || "",
        stage: payload.stage || "",
        transcript: payload.transcript || "",
        durationSeconds: payload.durationSeconds || 0,
        audioBase64: payload.audioBase64 || null,
        rubric: payload.rubric || rubric(payload.examType)
      };
    },

    /* 后端字段名与此不同时在 return 前做映射即可 */
    normalize(data) {
      const dims = (data.dimensionScores || data.dimensions || []).map((d) => ({
        key: d.key || d.name || "",
        name: d.name || d.key || "",
        score: typeof d.score === "number" ? d.score : null,
        maxScore: d.maxScore || 100,
        comment: d.comment || d.feedback || ""
      }));
      return {
        success: true,
        status: "ok",
        overallScore: typeof data.overallScore === "number" ? data.overallScore : null,
        dimensionScores: dims,
        strengths: data.strengths || [],
        weaknesses: data.weaknesses || [],
        suggestions: data.suggestions || [],
        improvedExamples: data.improvedExamples || [],
        raw: data
      };
    },

    requestEvaluate(payload) {
      const st = this.status();
      return fetch(st.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequest(payload))
      }).then((res) => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)))
        .then((data) => this.normalize(data));
    },

    /* 统一入口：未配置 / 无转写文本时明确返回未接入，绝不编造分数 */
    evaluate(payload) {
      payload = payload || {};
      const st = this.status();
      const base = {
        overallScore: null,
        dimensionScores: [],
        strengths: [],
        weaknesses: [],
        suggestions: [],
        improvedExamples: [],
        stage: payload.stage || "",
        examType: payload.examType || ""
      };
      if (!st.configured) {
        return Promise.resolve(Object.assign(base, {
          success: false, status: "not_configured", message: st.message
        }));
      }
      if (st.requiresTranscript && !payload.transcript) {
        return Promise.resolve(Object.assign(base, {
          success: false, status: "no_transcript",
          message: "还没有可用的转写文本：需要先接入转写服务（services/transcription.js）或允许浏览器离线提交音频。"
        }));
      }
      return this.requestEvaluate(payload).catch((err) => Object.assign(base, {
        success: false, status: "error",
        message: "评分请求失败：" + ((err && err.message) || "未知错误")
      }));
    }
  };

  /* 约定的对外函数签名 */
  window.evaluateSpeech = function evaluateSpeech(args) {
    return E.evaluate(args || {});
  };
  window.TOPE_Evaluation = E;
})();
