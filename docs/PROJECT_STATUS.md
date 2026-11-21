# TOPE Mate — Shared Project Status
Updated: 2026-11-21

## Repository
Private repository: `ithilqiqi-afk/tope-mate`. Default branch: `main`. A's GitHub account `zshw0124` has read/write access. Initial remote main was `caa400f9f6edf655f9120d2eb296c39817dd959d` (only README and .gitignore).

## Stable frontend (A, local; import pending)
A's vanilla HTML/CSS/JS prototype passed six manual checks: B/C home, C draw, accelerated phase transitions, pause/resume and warning, sample report, B candidate cards/discussion. Local data: C=196 questions; B=22 sets. Not yet verified from GitHub. No recording, transcription or real AI evaluation in audited version.

## B modules (reported, files not yet reviewed here)
C=139 candidate items and B=28 candidate sets; JSON/Excel, source annotations, draft scoring contract and mock evaluation. Do not treat these numbers as audited or confirmed official exam questions.

## Current activities
A: import baseline to `feature/frontend-import`, run structural and browser checks, create PR before merging to main. Then record voice per phase.
B: develop question-bank and AI-scoring branches, supply real JSON fixtures and protocol details.
Joint: confirm contract version and adapter tests; merge through PRs.

## Risks
B's schema and A's legacy globals differ; sample scores are not real AI evaluation; audio/voice capture not implemented; API keys must remain on server; browser microphone requires explicit testing.

## Working rule
Update this file after important PRs and tested merges. Record exact commit SHA and tests. Never claim tests were run if they were not.