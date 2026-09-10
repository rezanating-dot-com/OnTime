#!/usr/bin/env node
/**
 * DeepSeek second-opinion review.
 *
 * ── What this is ─────────────────────────────────────────────────────
 *
 * The paid rung above `qwen-worker.mjs`, ported from the pattern in the
 * sibling `logicly` project (`scripts/ds-review.ts`) as
 * `docs/qwen-workflow.md` said to do when a review needs more judgment
 * than a local 27B can give. Sends a branch's diff — plus the full
 * current content of each changed file, for context — to DeepSeek and
 * prints the review.
 *
 * DeepSeek is an advisor, never the reviewer or author of record.
 * Claude verifies every finding against the actual code before acting
 * on it, and appends a dispositioned entry to docs/ds-review-log.jsonl
 * so "how is DeepSeek doing" is answerable from evidence. A merge never
 * blocks on this script being slow or the API being down.
 *
 * The logicly pilot (2026-08-24, v4-pro) found the model caught 4/4
 * planted defects as a *reviewer* with no hallucinated findings, but
 * regressed 1 of 3 real bug-fix tasks as an *author*. Hence review-only.
 * This script runs `deepseek-flash`, which is cheaper and weaker than
 * the v4-pro that pilot measured — so the verify-everything rule binds
 * harder here, not softer.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   node scripts/ds-review.mjs                      # HEAD vs main
 *   node scripts/ds-review.mjs --base dev           # vs another base
 *   node scripts/ds-review.mjs --worktree           # uncommitted changes vs HEAD
 *   node scripts/ds-review.mjs --file src/a.ts --file src/b.ts   # no diff, whole files
 *   node scripts/ds-review.mjs --focus perf         # performance-oriented prompt
 *   node scripts/ds-review.mjs --think              # let the model reason first (small inputs only)
 *   node scripts/ds-review.mjs --system "..."       # fully custom system prompt
 *
 * Requires DEEPSEEK_API_KEY in the environment or in ./.env.local
 * (gitignored via `*.local`). Prints the review to stdout, then a JSON
 * log-entry skeleton to stderr to fill in with dispositions.
 *
 * Data boundary: this transmits source (diff + changed-file contents) to
 * DeepSeek's API. OnTime has no PHI and keeps secrets out of source, so
 * unlike logicly there is nothing here that must not leave the machine —
 * but .env.local itself is never part of a diff, and must not be passed
 * with --file.
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { Agent } from 'undici';

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-flash';
// flash is a reasoning model and its reasoning is billed against this same
// budget. Measured 2026-09-10 on an 89k-char review prompt (one 200-line
// diff plus two whole files): with thinking on it burned 32000 AND THEN
// 64000 reasoning tokens and returned empty content with
// finish_reason=length both times — no output at all, not truncated output.
// 64000 is the ceiling the API accepts, so raising it further is not an
// option. Hence thinking is off by default (see THINKING_DISABLED); with it
// off the same prompt answers well inside this budget.
const DEFAULT_MAX_TOKENS = 32_000;
// Turns off flash's reasoning pass. The API accepts this and returns a
// response with no reasoning_content. Pass --think to re-enable it, but keep
// the input small when you do — see the note above.
const THINKING_DISABLED = { type: 'disabled' };
// Keeps the request well inside the model's context window with room for
// the reasoning + answer above.
const MAX_CONTEXT_CHARS = 300_000;
// A reasoning model on a large diff takes minutes, and a non-streaming
// completion can't send its response headers until it has fully finished
// (it needs the final Content-Length). Node's default undici Agent kills a
// connection that sends nothing for 5 minutes, which surfaces as a bare
// `fetch failed` while the model is in fact still working.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const REVIEWABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|gradle|java|kt)$/;

const BASE_SYSTEM_PROMPT =
  'You are reviewing a change to OnTime, an offline-first Islamic prayer-times app ' +
  '(React 19 + TypeScript + Vite, Capacitor 8 for Android, three.js/globe.gl for the ' +
  'home globe and qibla views, the `adhan` library for prayer calculation, Vitest + ' +
  'React Testing Library for tests). It runs in a mobile WebView on battery, so ' +
  'render cadence, GPU uploads, listener lifecycles and wasted recomputation matter ' +
  'as much as correctness. ';

const FOCUS_PROMPTS = {
  bugs:
    'Report only findings you are confident are real defects — correctness, ' +
    'lifecycle/leak, race, or regression. For each finding give: severity ' +
    '(High/Medium/Low), the file and line/area, the concrete failure scenario ' +
    '(what input or sequence produces what wrong result), and why the code is ' +
    'wrong. If the change is fine, say so plainly. Do not pad the review with ' +
    'style nits.',
  perf:
    'Focus on performance: work repeated more often than its inputs change, ' +
    'allocation or GPU uploads in a per-frame or per-event path, effects that ' +
    're-run on identity changes rather than value changes, synchronous work on ' +
    'the main thread, listeners that outlive their component, and bundle/parse ' +
    'cost paid before first paint. For each finding give: severity ' +
    '(High/Medium/Low), the file and line/area, how often the wasted work ' +
    'actually runs, and what it costs. Say plainly when something is already ' +
    'optimal. Do not report style nits or speculative micro-optimizations whose ' +
    'benefit you cannot argue for concretely.',
};

function parseArgs(argv) {
  const args = {
    base: 'main',
    worktree: false,
    files: [],
    focus: 'bugs',
    system: undefined,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    think: false,
    task: undefined,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--worktree') args.worktree = true;
    else if (a === '--file') args.files.push(argv[++i]);
    else if (a === '--focus') args.focus = argv[++i];
    else if (a === '--system') args.system = argv[++i];
    else if (a === '--think') args.think = true;
    else if (a === '--max-output') args.maxTokens = Number(argv[++i]);
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]) * 1000;
    else rest.push(a);
  }
  args.task = rest.join(' ') || undefined;
  return args;
}

function readApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) {
    throw new Error('DEEPSEEK_API_KEY not in env and .env.local not found — run from repo root');
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (line.startsWith('DEEPSEEK_API_KEY=')) return line.slice('DEEPSEEK_API_KEY='.length).trim();
  }
  throw new Error('DEEPSEEK_API_KEY not set in .env.local');
}

function git(...cmdArgs) {
  return execFileSync('git', cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Assemble the user prompt from the diff and changed-file contents, dropping
 * whole file bodies (largest first) if the total would exceed maxChars. The
 * diff itself is never truncated — it is the thing under review.
 */
export function buildReviewPrompt(header, diff, files, task, maxChars = MAX_CONTEXT_CHARS) {
  const parts = [];
  if (task) parts.push(`## What to look at\n${task}\n\n`);
  parts.push(header);
  if (diff) parts.push(`## Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n`);
  const fixed = parts.join('');

  let budget = maxChars - fixed.length;
  const truncated = [];
  const kept = [];
  const readable = files.filter((f) => f.content !== null);
  // Smallest first: small files carry the most context per character, so
  // when over budget the largest are the ones dropped.
  const bySize = [...readable].sort((a, b) => a.content.length - b.content.length);
  for (const f of bySize) {
    const block = `## Current content of ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
    if (block.length <= budget) {
      kept.push(block);
      budget -= block.length;
    } else {
      truncated.push(f.path);
    }
  }
  const note = truncated.length
    ? `(Content of ${truncated.join(', ')} omitted for length — judge those from the diff alone.)\n`
    : '';
  return { prompt: fixed + kept.join('') + note, truncated };
}

/** Skeleton of the log entry Claude finalizes after verifying every finding. */
function logSkeleton(meta, usage, wallSeconds, truncated, finishReason, think) {
  return {
    date: new Date().toISOString().slice(0, 10),
    ...meta,
    model: MODEL,
    tokens_in: usage?.prompt_tokens ?? null,
    tokens_out: usage?.completion_tokens ?? null,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    thinking: think ? 'on' : 'off',
    wall_seconds: Math.round(wallSeconds),
    truncated_input: truncated.length ? truncated : undefined,
    finish_reason: finishReason,
    findings: [
      // One per DeepSeek finding, after Claude verifies it against the code:
      // { severity, summary, disposition: 'confirmed-fixed' |
      //   'confirmed-deliberate' | 'false-positive' | 'already-caught' }
    ],
    note: null,
  };
}

/** Read a path at a revision, or from the working tree when rev is null. */
function contentAt(rev, p) {
  if (!REVIEWABLE.test(p)) return null;
  try {
    return rev === null ? readFileSync(p, 'utf8') : git('show', `${rev}:${p}`);
  } catch {
    return null; // deleted in this change, or unreadable
  }
}

async function callDeepSeek(key, systemPrompt, userPrompt, maxTokens, timeoutMs, think) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        ...(think ? {} : { thinking: THINKING_DISABLED }),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
      dispatcher: new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs }),
    });
    if (!res.ok) {
      throw new Error(`DeepSeek API ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    return { out: await res.json(), wallSeconds: (Date.now() - t0) / 1000 };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const focusPrompt = FOCUS_PROMPTS[args.focus];
  if (!focusPrompt && !args.system) {
    console.error(`unknown --focus ${args.focus} (expected: ${Object.keys(FOCUS_PROMPTS).join(', ')})`);
    process.exitCode = 1;
    return;
  }
  const systemPrompt = args.system ?? BASE_SYSTEM_PROMPT + focusPrompt;

  let diff = '';
  let header = '';
  let files = [];
  const meta = { base: null, branch: null, diff_stat: null, files: args.files };

  if (args.files.length) {
    // Whole-file review with no diff: a cold read of code that isn't changing.
    files = args.files.map((p) => {
      if (!existsSync(p)) throw new Error(`--file not found: ${p}`);
      // The same filter the diff path applies through contentAt(). Without it
      // this branch would read and transmit anything at all, including the
      // .env.local this script reads its own key from — the header above
      // promises that boundary, so enforce it rather than documenting it.
      if (!REVIEWABLE.test(p)) {
        throw new Error(`--file refuses ${p}: not a source file this script will transmit`);
      }
      return { path: p, content: readFileSync(p, 'utf8') };
    });
    header = `Cold review of ${args.files.length} file(s) — no diff, judge the code as it stands.\n\n`;
  } else {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    meta.branch = branch;
    let from;
    if (args.worktree) {
      diff = git('diff', 'HEAD');
      meta.diff_stat = git('diff', '--stat', 'HEAD');
      from = null; // read context from the working tree, matching the diff
      header = `Uncommitted changes on branch ${branch}.\nLast commit: ${git('log', '-1', '--format=%s').trim()}\n\n`;
      meta.base = 'working-tree';
    } else {
      const mergeBase = git('merge-base', args.base, 'HEAD').trim();
      diff = git('diff', mergeBase, 'HEAD');
      meta.diff_stat = git('diff', '--stat', mergeBase, 'HEAD');
      // Read context from HEAD, not the working tree — uncommitted edits must
      // not desync the file contents from the diff under review.
      from = 'HEAD';
      header = `Branch ${branch} vs ${args.base}.\nHead commit: ${git('log', '-1', '--format=%s').trim()}\n\n`;
      meta.base = args.base;
    }
    if (!diff.trim()) {
      console.log(`No changes vs ${meta.base} — nothing to review.`);
      return;
    }
    const changed = (
      args.worktree
        ? git('diff', '--name-only', 'HEAD')
        : git('diff', '--name-only', git('merge-base', args.base, 'HEAD').trim(), 'HEAD')
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    meta.files = changed;
    files = changed.map((p) => ({ path: p, content: contentAt(from, p) }));
    meta.diff_stat = meta.diff_stat.trim().split('\n').pop()?.trim() ?? '';
  }

  const { prompt, truncated } = buildReviewPrompt(header, diff, files, args.task);
  if (truncated.length) {
    console.error(`note: file contents omitted for length: ${truncated.join(', ')}`);
  }

  console.error(
    `Sending ~${Math.round(prompt.length / 1000)}k chars to ${MODEL} (focus: ${args.focus}, thinking: ${args.think ? 'on' : 'off'}) — this takes minutes on a large diff...`
  );
  const { out, wallSeconds } = await callDeepSeek(
    readApiKey(),
    systemPrompt,
    prompt,
    args.maxTokens,
    args.timeoutMs,
    args.think
  );

  const choice = out.choices?.[0];
  const review = choice?.message?.content ?? '';
  const finishReason = choice?.finish_reason;

  if (!review.trim()) {
    console.error(
      `empty review (finish_reason=${finishReason}, reasoning_tokens=${out.usage?.completion_tokens_details?.reasoning_tokens ?? '?'}) — the model produced nothing. If you passed --think, drop it or shrink the input; 64000 is the API's ceiling and thinking can exhaust it on a large prompt.`
    );
    process.exitCode = 1;
    return;
  }
  if (finishReason !== 'stop') {
    console.error(
      `WARNING: finish_reason=${finishReason} — the review below is TRUNCATED; treat it as incomplete and rerun`
    );
  }

  console.log(`════════ DeepSeek (${MODEL}) second-opinion review ════════\n`);
  console.log(review);

  console.error(
    '\n──── log entry skeleton (verify every finding, disposition it, append to docs/ds-review-log.jsonl) ────'
  );
  console.error(JSON.stringify(logSkeleton(meta, out.usage, wallSeconds, truncated, finishReason, args.think)));
}

const invokedDirectly = process.argv[1]?.endsWith('ds-review.mjs') ?? false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
