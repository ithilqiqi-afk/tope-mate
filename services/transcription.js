/* ───────────────────────── 语音转写前端接入层 ─────────────────────────
   对接 modules/speech-transcription（默认 http://127.0.0.1:3002/api/transcribe，
   契约见 modules/speech-transcription/docs/transcribe_api.md）。

   职责边界：
     · 本文件只做「上传录音 → 解析信封 → 绑定 session/stage」，不产生任何文本。
     · 服务端没给 transcript 时一律返回空串，绝不本地编造。
     · API Key 只在服务端，本文件不出现任何密钥。
     · 上传与否由调用方（报告页的「生成 AI 分析」确认框）决定，用户没确认就不会走到这里。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  function cfg() { return (window.TOPE_CONFIG || {}).services || {}; }

  function endpoint() { return String(cfg().transcribeEndpoint || "").trim(); }

  /* 与转写服务的错误码表保持一致，页面据此决定能不能重试。 */
  var RETRYABLE = {
    MALFORMED_MULTIPART: true, BODY_TIMEOUT: true,
    PROVIDER_HTTP_ERROR: true, PROVIDER_NETWORK_ERROR: true, PROVIDER_BAD_RESPONSE: true, PROVIDER_TIMEOUT: true
  };

  function failure(status, code, message, extra) {
    var out = {
      success: false,
      status: status,
      code: code || null,
      transcript: "",
      empty: false,
      retryable: code ? !!RETRYABLE[code] : false,
      message: message
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  /** 解开 {success,data,meta} 信封；形状不对就当服务异常，不做任何猜测性兜底。 */
  function unwrap(json, payload) {
    if (!json || typeof json !== "object") {
      return failure("bad_envelope", "BAD_ENVELOPE", "转写服务返回的不是约定结构，本次不采用任何文本。", { stage: payload.stage, sessionId: payload.sessionId });
    }
    if (json.success === false) {
      const err = json.error || {};
      return failure("service_error", err.code || "SERVICE_ERROR", err.message || "转写服务返回失败，但未说明原因。", {
        retryable: err.retryable === true, stage: payload.stage, sessionId: payload.sessionId
      });
    }
    const data = json.data || {};
    const meta = json.meta || {};
    /* 服务把 sessionId/stage 原样回传；对不上说明这是过期请求的结果，直接丢弃。 */
    if (payload.sessionId !== undefined && payload.sessionId !== null &&
        meta.sessionId !== undefined && meta.sessionId !== null && String(meta.sessionId) !== String(payload.sessionId)) {
      return failure("stale", "STALE_RESULT", "转写结果属于另一轮练习，已丢弃。", { stage: payload.stage, sessionId: payload.sessionId });
    }
    const transcript = typeof data.transcript === "string" ? data.transcript : "";
    return {
      success: true,
      status: transcript.trim() ? "ok" : "no_speech",
      code: null,
      transcript: transcript,
      empty: transcript.trim().length === 0,
      retryable: false,
      language: data.language || payload.language || "en",
      model: data.model || null,
      format: data.format || null,
      bytesReceived: typeof data.bytesReceived === "number" ? data.bytesReceived : null,
      detectedLanguages: Array.isArray(data.detectedLanguages) ? data.detectedLanguages : [],
      demoOnly: meta.demoOnly === true,
      stage: payload.stage,
      stageName: payload.stageName || meta.stageName || null,
      sessionId: payload.sessionId,
      message: transcript.trim() ? "" : "转写服务没有听到可用语音。"
    };
  }

  const T = {
    kind: "transcription",

    /* 接入状态：页面据此显示「尚未接入」而不是编造结果 */
    status() {
      const url = endpoint();
      const recorder = window.TOPE_Recorder;
      return {
        configured: !!url,
        endpoint: url,
        provider: String(cfg().transcribeProvider || "").trim() || "未指定",
        sendAudio: cfg().sendAudioToBackend !== false,
        recorderReady: !!(recorder && recorder.supported()),
        label: url ? "已配置：" + url : "尚未接入",
        message: url
          ? "已指向转写服务 " + url + "，只有你确认后才会上传录音。"
          : "转写服务尚未接入：本页面不会生成任何文字转写结果。" +
            "接入位置为 config/exam-config.js 的 services.transcribeEndpoint，启动方式见 modules/speech-transcription/README.md。"
      };
    },

    buildFormData(payload) {
      const fd = new FormData();
      const blob = payload.audioBlob;
      const mimeType = payload.mimeType || (blob && blob.type) || "";
      /* 扩展名由服务端按 MIME 决定，这里只给一个可读的占位名。 */
      fd.append("audio", blob, payload.fileName || "tope-mate-recording");
      fd.append("meta", JSON.stringify({
        sessionId: payload.sessionId === undefined || payload.sessionId === null ? null : String(payload.sessionId),
        stage: payload.stage,
        stageName: payload.stageName || null,
        examType: payload.examType || null,
        questionId: payload.questionId || null,
        mimeType: mimeType,
        durationSeconds: typeof payload.durationSeconds === "number" ? Math.round(payload.durationSeconds) : null,
        language: payload.language || ((window.TOPE_CONFIG || {}).scoring || {}).language || "en"
      }));
      return fd;
    },

    /**
     * 一次转写请求。signal 允许调用方在离开页面或开始新一轮考试时作废它，
     * 过期响应会被丢弃而不是覆盖新一轮的结果。
     */
    requestTranscribe(payload, signal) {
      const s = cfg();
      const timeoutMs = (s.requestTimeoutMs && s.requestTimeoutMs.transcribe) || 120000;
      const maxBytes = s.maxAudioBytes || 12 * 1024 * 1024;
      if (payload.audioBlob && payload.audioBlob.size > maxBytes) {
        return Promise.resolve(failure("too_large", "PAYLOAD_TOO_LARGE",
          "这段录音超过 " + Math.round(maxBytes / 1024 / 1024) + " MB 上限，请先在报告页重新录或缩短这一阶段。",
          { stage: payload.stage, sessionId: payload.sessionId }));
      }
      const controller = signal ? null : new AbortController();
      const usedSignal = signal || controller.signal;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      return fetch(endpoint(), { method: "POST", body: T.buildFormData(payload), signal: usedSignal })
        .then((res) => res.text().then((text) => ({ ok: res.ok, status: res.status, json: safeJson(text) })))
        .then((res) => {
          if (res.json === null) {
            return failure("bad_response", "BAD_RESPONSE", "转写服务返回了无法解析的内容（HTTP " + res.status + "），本次不采用任何文本。",
              { stage: payload.stage, sessionId: payload.sessionId });
          }
          return unwrap(res.json, payload);
        })
        .catch((err) => {
          if (err && (err.name === "AbortError" || err.code === 20)) {
            return failure(signal ? "cancelled" : "timeout", signal ? "CANCELLED" : "BODY_TIMEOUT",
              signal ? "本次转写已取消（离开页面或开始了新一轮练习）。" : "转写请求超时，请稍后重试。",
              { retryable: !signal, stage: payload.stage, sessionId: payload.sessionId });
          }
          return failure("network", "NETWORK_ERROR",
            "连不上转写服务：" + ((err && err.message) || "未知错误") + "。请确认已执行 modules/speech-transcription 的 npm run serve。",
            { retryable: true, stage: payload.stage, sessionId: payload.sessionId });
        })
        .finally(() => { if (timer) clearTimeout(timer); });
    },

    /* 统一入口：未配置 / 无音频时明确返回状态，绝不伪造文本 */
    transcribe(payload, signal) {
      payload = payload || {};
      const st = this.status();
      if (!st.configured) return Promise.resolve(failure("not_configured", "NOT_CONFIGURED", st.message, { stage: payload.stage, sessionId: payload.sessionId }));
      if (!payload.audioBlob) {
        return Promise.resolve(failure("no_audio", "MISSING_AUDIO",
          "本阶段没有可上传的录音（未授权麦克风、该阶段不录音，或录音未能确认完整结束）。",
          { stage: payload.stage, sessionId: payload.sessionId }));
      }
      return this.requestTranscribe(payload, signal);
    },

    /* 只探测可达性，不上传任何音频，用于报告页显示服务是否在线。 */
    health() {
      const url = ((window.TOPE_CONFIG || {}).services || {}).healthEndpoints || {};
      if (!url.transcribe) return Promise.resolve({ online: false, message: "未配置转写服务地址。" });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      return fetch(url.transcribe, { method: "GET", signal: controller.signal })
        .then((res) => res.text().then((text) => ({ res, json: safeJson(text) })))
        .then((r) => ({
          online: r.res.ok && !!r.json && r.json.success === true,
          keyConfigured: !!(r.json && r.json.data && r.json.data.keyConfigured),
          model: r.json && r.json.data ? r.json.data.model : null,
          message: r.res.ok ? "转写服务在线。" : "转写服务返回 HTTP " + r.res.status + "。"
        }))
        .catch(() => ({ online: false, keyConfigured: false, model: null, message: "转写服务未启动或无法访问。" }))
        .finally(() => clearTimeout(timer));
    }
  };

  function safeJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  window.transcribeAudio = function transcribeAudio(args, signal) { return T.transcribe(args || {}, signal); };
  window.TOPE_Transcription = T;
})();
