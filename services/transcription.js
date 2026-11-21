/* ───────────────────────── 语音转写接口（预留） ─────────────────────────
   本文件只定义接口与调用约定，当前没有接入任何真实转写服务。

   接入方式（由成员 B / 后端负责）：
     1. 自建一个后端代理，例如 http://127.0.0.1:8787/api/transcribe，
        由后端持有 API Key 并调用讯飞 / 阿里云 / OpenAI 等转写服务。
     2. 把后端地址填进 config/exam-config.js 的 services.transcribeEndpoint。
        填了地址，本文件的状态就从「尚未接入」变成「已配置」，页面才会真的发请求。
     3. 需要额外参数（采样率、语言、时间戳等）时改 buildFormData()。

   安全约定：API Key 绝对不能写在前端 JavaScript 里。前端只跟自己的后端说话，
   本文件不会、也不应该出现任何密钥。
───────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  function services() {
    const cfg = window.TOPE_CONFIG || {};
    return cfg.services || {};
  }

  const T = {
    kind: "transcription",

    /* 当前转写能力的接入状态，页面据此显示「尚未接入」而不是编造结果 */
    status() {
      const s = services();
      const endpoint = String(s.transcribeEndpoint || "").trim();
      const recorder = window.TOPE_Recorder;
      return {
        configured: !!endpoint,
        endpoint: endpoint,
        provider: String(s.transcribeProvider || "").trim() || "未指定",
        sendAudio: s.sendAudioToBackend !== false,
        recorderReady: !!(recorder && recorder.supported()),
        label: endpoint ? "已配置：" + endpoint : "尚未接入",
        message: endpoint
          ? "已指向后端 " + endpoint + "，返回结果将显示在报告页。"
          : "转写服务尚未接入：本页面不会生成任何文字转写结果。" +
            "接入位置为 config/exam-config.js 的 services.transcribeEndpoint，" +
            "请求实现见 services/transcription.js 的 requestTranscribe()。"
      };
    },

    /* 按约定的入参组装请求体；后端换协议时只改这里 */
    buildFormData(payload) {
      const fd = new FormData();
      if (payload.audioBlob) fd.append("audio", payload.audioBlob, payload.fileName || "speech.webm");
      fd.append("meta", JSON.stringify({
        examType: payload.examType,
        stage: payload.stage,
        mimeType: payload.mimeType,
        durationSeconds: payload.durationSeconds,
        question: payload.question,
        language: payload.language || "en"
      }));
      return fd;
    },

    requestTranscribe(payload) {
      const st = this.status();
      return fetch(st.endpoint, { method: "POST", body: this.buildFormData(payload) })
        .then((res) => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)))
        .then((data) => ({
          success: true,
          status: "ok",
          transcript: String(data.transcript || ""),
          language: data.language || "en",
          stage: payload.stage,
          confidence: typeof data.confidence === "number" ? data.confidence : null,
          words: data.words || null,
          raw: data
        }));
    },

    /* 统一入口：未配置时明确返回 not_configured，绝不伪造文本 */
    transcribe(payload) {
      payload = payload || {};
      const st = this.status();
      if (!st.configured) {
        return Promise.resolve({
          success: false,
          status: "not_configured",
          transcript: "",
          language: "en",
          stage: payload.stage || "",
          message: st.message
        });
      }
      if (!payload.audioBlob) {
        return Promise.resolve({
          success: false,
          status: "no_audio",
          transcript: "",
          stage: payload.stage || "",
          message: "本阶段没有录音（未授权麦克风或该阶段配置为不录音）。"
        });
      }
      return this.requestTranscribe(payload).catch((err) => ({
        success: false,
        status: "error",
        transcript: "",
        stage: payload.stage || "",
        message: "转写请求失败：" + ((err && err.message) || "未知错误")
      }));
    }
  };

  /* 约定的对外函数签名，方便后续成员直接对接 */
  window.transcribeAudio = function transcribeAudio(args) {
    return T.transcribe(args || {});
  };
  window.TOPE_Transcription = T;
})();
