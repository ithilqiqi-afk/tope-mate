// Test isolation: the dev machine may carry real provider env vars (SCORING_PROVIDER,
// BAILIAN_BASE_URL, keys...). Clear them so tests assert defaults deterministically,
// matching the clean CI environment. Tests that need env values set them via withEnv.
for(const k of ['SCORING_MODE','SCORING_PROVIDER','SCORING_TIMEOUT_MS','OPENAI_API_KEY','OPENAI_MODEL','DASHSCOPE_API_KEY','BAILIAN_MODEL','BAILIAN_BASE_URL'])
  delete process.env[k];