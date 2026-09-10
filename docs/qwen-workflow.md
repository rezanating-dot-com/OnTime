# Local grunt-work delegate (qwen)

Ported from the `logicly` project's DeepSeek-review pattern, adapted for a
free local worker instead of a paid API.

## What's running

- **Ollama**, local, keyless, OpenAI-compatible endpoint at
  `http://127.0.0.1:11434/v1`.
- **Worker model:** `qwen3.8-code-worker` — a custom Ollama build of
  `qwen3.8:27b-q4_K_M` (27B, Q4_K_M) with `num_ctx 32768` / `num_predict 8192`.
  Built and tuned in a sibling project; shared across all local projects.
- Driven from this repo via `scripts/qwen-worker.mjs` — see that file's
  header for usage. The script reads `--file`/`--diff` content itself so
  Claude never has to paste file bodies into a prompt just to hand them off.

## The split

| Role | Who |
|---|---|
| Planning, multi-file reasoning, integration | Claude (orchestrator) |
| Verifying every qwen output against real code | Claude — non-negotiable |
| Drafting user-story tests, enumerating edge cases | qwen |
| Boilerplate, mechanical transforms, summaries | qwen |
| Second-opinion diff review | qwen |
| Sole authorship of production code | **Nobody** — always Claude-reviewed |

qwen (27B, Q4 quantized) is meaningfully weaker than the DeepSeek v4-pro
model the logicly pattern was built around — and that pilot already found
DeepSeek too weak to author code solo (regressed 1 of 3 bug-fix tasks as
author, while catching 4/4 planted defects as a *reviewer*). So here the
bar is tighter: qwen drafts and enumerates, it never lands unreviewed code.

## The rigorous-testing loop

A qwen-drafted test that merely passes is not verified — it can pass while
asserting nothing. For every test qwen drafts:

1. Read every assertion. Does it actually check the behavior it claims to?
2. Run it — confirm it passes against the real code.
3. Spot-check that it *fails* when the code under test is deliberately
   broken (comment out the guard, flip a comparison, whatever the test
   claims to cover). A test that can't fail is worse than no test.
4. Never rewrite a test to make it pass — if it's catching something real,
   fix the code; if the test is wrong, fix the test's assertion, don't
   loosen it until it goes green.

## Logging — `docs/qwen-task-log.jsonl`

Every delegated task gets one line, appended after Claude reviews the
output. `scripts/qwen-worker.mjs` prints a skeleton to stderr after each
run — fill in `disposition` and `note` and append it:

- `disposition: "accepted"` — used as-is or with trivial edits
- `disposition: "rewritten"` — kept the idea, rewrote most of it
- `disposition: "rejected"` — discarded, qwen missed the point or was wrong

On request ("how's qwen doing"), analyze the log: acceptance rate, what
kinds of tasks it's reliable on, false-positive rate on reviews, typical
wall time.

## When to escalate past qwen — `scripts/ds-review.mjs`

The escalation this section used to describe as future work has been done.
`scripts/ds-review.mjs` is the paid rung: DeepSeek via API, review-only,
logged to `docs/ds-review-log.jsonl` the same way qwen's work is logged to
`docs/qwen-task-log.jsonl`. Use it when a second opinion needs more judgment
than 27B can give, or when qwen is busy with another task.

```bash
node scripts/ds-review.mjs                    # HEAD vs main
node scripts/ds-review.mjs --base dev         # vs another base
node scripts/ds-review.mjs --worktree         # uncommitted changes
node scripts/ds-review.mjs --focus perf --file src/a.ts --file src/b.ts
```

Needs `DEEPSEEK_API_KEY` in the environment or in `.env.local` (gitignored
by the `*.local` rule). Reviewing a branch diff takes seconds and costs
cents — nothing like qwen's minutes of CPU inference.

Three things learned setting it up, all of them the kind that waste an hour:

- **Thinking is off by default, and that is not a cosmetic choice.**
  `deepseek-flash` is a reasoning model whose reasoning is billed against
  the same `max_tokens` budget as its answer. On an 89k-char review prompt
  it burned 32,000 and then 64,000 reasoning tokens and returned *empty
  content* both times — no output at all, not truncated output. 64,000 is
  the ceiling the API accepts, so there is no raising your way out of it.
  With thinking disabled the same prompt answers in seven seconds. `--think`
  re-enables it; keep the input small if you use it.
- **The model does not know what is switched off.** Two of the four
  cold-read perf reviews spent their top findings on the ground-view compass
  path and the sun dome, both of which are commented out of the app. Check
  whether a hot path is actually reachable before acting on a finding about
  it.
- **Same rule as qwen, harder.** DeepSeek is an advisor, never the author or
  the reviewer of record. The logicly pilot measured v4-pro; `flash` is the
  cheaper, weaker model, so verify every finding against the real code
  before acting. Across six reviews it landed 8 fixed and 1 still
  open out of 29 findings, with the rest split between dead code, deliberate
  trade-offs, and three outright wrong claims. It is markedly better on a
  branch diff than on a cold read: 2 of 2 on the one diff it was given.

Retro on request ("how's DeepSeek doing"): analyse
`docs/ds-review-log.jsonl` for unique catches, false-positive rate and cost.

## Practical notes

- CPU inference is slow (minutes per call) — run `qwen-worker.mjs` via
  background Bash, not inline.
- First call in a while reloads the ~17GB model into RAM. Warm it with
  `ollama run qwen3.8-code-worker "hi"` if latency matters.
- qwen's thinking mode is always-on via the `/v1` endpoint and counts
  against the output budget (default 8192 tokens). A reasoning-heavy task
  (e.g. a multi-file bug hunt) can burn the *entire* budget on thinking
  and return empty content with `finish_reason: "length"` — not
  truncated output, no output at all. Pass `--max-output <tokens>` to
  raise the ceiling (ollama honors a client value above the model's
  baked-in default — verified). Keep input small enough that
  input + output stays under the model's 32768 `num_ctx`, or the extra
  output budget just pushes the same failure further out. The script
  warns on any `finish_reason !== "stop"` — treat a warned response as
  incomplete.
- A non-streaming chat completion can't send any HTTP response until the
  model has fully finished (it needs the final `Content-Length`), and
  Node's default `fetch` kills a connection that sends no response within
  5 minutes. A large/slow prompt (many files, or a hard reasoning task)
  can blow past that and fail with a bare `fetch failed`, even though the
  model was still working. `qwen-worker.mjs` sets a custom undici
  `Agent` matching its own `--timeout` to avoid this — if this error comes
  back anyway, it's this timeout, not a real network problem; re-run, or
  shrink the prompt.
