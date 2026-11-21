# TOPE Mate — Frontend Interface Audit (A)
Date: 2026-11-21. Based on A's uploaded original files. The frontend source has not yet been pushed to this branch.

## Runtime and entrypoints
Vanilla HTML/CSS/JavaScript, without a build system. `index.html` loads, in order: `config/exam-config.js`, `data/questions-c.js`, `data/questions-b.js`, `data/report-samples.js`, `app.js`. Local run: `python -m http.server 5173`.

## Question bank C
`window.TOPE_BANK_C = { version, questions: [{id, cat, en, zh}] }`. Categories live in `window.TOPE_CATEGORIES` (five keys: society_tech, culture_tradition, study_campus, life_relationship, career_growth). Actual source contains 196 questions. `Bank.list(type,category)` filters `cat`; `Bank.draw` randomly chooses an unseen ID, resetting seen IDs after exhaustion. No source metadata, tags, image references, per-item follow-ups, or nested main-question shape. `buildQA()` samples generic and category-specific strings in `window.TOPE_QA_SAMPLES`, not answer-dependent questions.

## Question bank B
`window.TOPE_BANK_B = {version,selfIntro,sets:[{id,cat,topic,topicZh,cards:[{key,point,pointZh}],discussion,discussionZh,followUps:[{key,q}]}]}`. Actual source: 22 sets with A/B/C cards. `prepareItem()` randomly picks cardKey; `topicCardHtml()` shows the assigned card and other candidate cards; `sidePanelHtml()` shows discussion question. No per-set 90/120s duration override, no image card support. Default presentation duration is exam-level `TOPE_CONFIG.B.phases[*].seconds=90`.

## Timing and audio
`TOPE_CONFIG.C.phases`: prepare=600, speech=180, qa=120. B: intro=40, prepare=60, presentation=90, discussion=300. `Timer` provides start/arm/pause/resume/stop/tick; `S.phaseLog` records planned/actual seconds; `startSession`, `runPhase`, `advance`, `endSession` control progression. There is no MediaRecorder, audio Blob/File export, transcription or real scoring request in the audited code. Elapsed phase time is available via `S.phaseLog[].actual`, subject to timer behavior and user-controlled skipping.

## Sample report
`buildReport()` generates `{overall,band,bandText,scores,dimDetail,weakest,nextStep,ratio,duration}`, with `scores` object keyed by content/organization/language/delivery, `dimDetail` keyed by dimension and containing the selected sample text object. `routes.report()` renders those fields and `S.phaseLog`. `window.TOPE_REPORT_SAMPLES` supplies disclaimer, overall bands, dimension sample text and next-step templates. Scores are synthetic; no transcript is used. Current UI does NOT render strengths/weaknesses arrays, evidence, PEEL or improvedExpressions.

## Adapter integration points (proposals, not frozen)
- Build B JSON -> legacy C/B `Bank` adapters; preserve the old IDs and provenance, do not silently merge duplicate questions.
- Map new per-set presentationSeconds into the selected B phase without mutating the global B exam default; require explicit UX for variable timing.
- Extend topic card rendering for image URLs with fallback and accessibility text; never insert untrusted HTML unsanitized.
- Introduce recorder on voice stages, asynchronously finish MediaRecorder before using Blob; add a transcription service separately.
- Scoring request candidate: `{examType,question,stage,transcript,durationSeconds,rubric}`; candidate response: `{scores,strengths,weaknesses,suggestions,evidence,peel,improvedExpressions}`. Preserve existing sample report until the real adapter and error states have been tested.
- Current settings saving while paused can interrupt timing due to `go(currentRoute)` invoking `Timer.stop()`. Data self-check also dereferences bank globals too early if scripts are missing.

## Verification boundaries
A reported 6/6 local browser checks passed. Uploaded data passed structural checks (196 C IDs unique; 22 B sets complete). Neither B's new candidate JSON nor real recording/scoring implementation was available in this audit. Do not represent candidate questions as verified past exam questions.