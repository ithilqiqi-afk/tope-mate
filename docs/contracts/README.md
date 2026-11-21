# Interface contract — draft 0.1 (NOT FROZEN)

This directory will hold jointly agreed C/B question-bank schemas and evaluation request/response schemas, examples, and validation tests.

Proposed evaluation request fields:
- `examType`: `"B" | "C"`
- `question`: question/task object
- `stage`: exam phase key
- `transcript`: English transcription, string
- `durationSeconds`: observed response duration in seconds
- `rubric`: rubric object and version

Proposed evaluation response fields:
- `scores`: dimension scores, proposed 0–100 scale
- `strengths`, `weaknesses`, `suggestions`: arrays of feedback items
- `evidence`: transcript-grounded citations
- `peel`: PEEL analysis where applicable
- `improvedExpressions`: suggested rewrites

These are proposals, NOT a finalized agreement. A's current report uses `overall`, `scores`, `dimDetail`, `band` and other sample-only fields. Prefer adapters and versioned fixtures over replacing the existing rendering flow. B must provide representative actual JSON and scoring outputs before freezing. Never score pronunciation from text-only transcription.