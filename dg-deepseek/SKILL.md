---
name: dg-deepseek
description: Save Codex and Claude Code tokens by coordinating expensive reasoning agents with cheaper DeepSeek/reasonix workers. Use when a software task should be split into architecture, design, planning, implementation delegation, research delegation, debugging triage, or final review; when the user mentions DeepSeek, reasonix cli, Claude Code, token savings, model routing, worker agents, cheap model execution, expensive model review, or "let DeepSeek do the labor"; or when Codex needs to decide whether to do a task itself or delegate a scoped code/search/debug subtask.
---

# DG DeepSeek

## Core Rule

Use Codex or Claude Code as the director and gatekeeper. Use DeepSeek through `reasonix` as the worker for scoped, verifiable, low-risk execution. The goal is to conserve Codex/Claude token budget for tasks that need judgment, architecture, taste, and final review.

Default principle:

> DeepSeek is the hands. Codex/Claude is the brain and the reviewer.

Do not delegate final judgment. Always inspect DeepSeek's output before accepting it.

## Routing Matrix

Keep with Codex/Claude:

- Architecture, data flow, module boundaries, technical choices
- Frontend visual direction, interaction design, information hierarchy
- Ambiguous product requirements or tasks needing taste and tradeoff judgment
- Cross-module refactors, public API changes, migrations, auth, payment, security, data loss risk
- Hard bugs involving concurrency, lifecycle, build systems, state pollution, flaky tests, or unclear root cause
- Final review, regression risk assessment, test adequacy, merge readiness

Delegate to DeepSeek/reasonix:

- Localized code edits with clear inputs and outputs
- Small UI controls, small feature additions, CRUD plumbing, copy changes, style tweaks
- Boilerplate, adapters, repetitive transformations, test skeletons, fixture updates
- Ordinary lint/type/build/runtime errors with obvious failure messages
- Search and source-gathering when paired with a search-capable environment
- First-pass implementation of a plan already designed by Codex/Claude

Escalate back to Codex/Claude when:

- DeepSeek changes files outside scope
- The diff introduces a new abstraction without being asked
- The fix is broad, speculative, or mostly deletes tests
- The task touches security, persistence, schema, user data, billing, or production config
- The same error survives two DeepSeek attempts

## Workflow

1. Classify the task.
   - Decide whether it is brain-work, hand-work, research, or review.
   - If the user asked for a direct implementation and the change is low-risk, delegate the mechanical part and keep ownership of review.

2. Build context first.
   - Read the relevant files, tests, errors, and repo conventions before delegating.
   - Identify allowed files and validation commands.
   - Keep the delegated task narrow enough that success can be checked by diff and tests.

3. Send a task packet to DeepSeek.
   - Include goal, background, allowed files, forbidden actions, acceptance criteria, validation commands, and output format.
   - Prefer one task per invocation.
   - Include exact file paths and commands when known.

4. Review the result.
   - Inspect `git diff`, changed files, and any validation output.
   - Verify behavior against acceptance criteria.
   - Run or request targeted tests when the change matters.
   - Either accept, patch personally, or send one focused correction back to DeepSeek.

5. Finish as gatekeeper.
   - Summarize what changed.
   - Report validation.
   - Name residual risk or skipped checks.

## Preferred MCP Worker

If the `deepseek-code-worker` MCP tools are available, prefer them over raw shell calls.

Use the async worker for normal tasks:

```text
deepseek_start_implementation
```

Then poll or collect results with:

```text
deepseek_wait_for_job
deepseek_get_job
deepseek_tail_job
```

Avoid the synchronous compatibility worker for anything that might take more than a tiny edit:

```text
deepseek_implement_in_workspace
```

That synchronous tool is only for very small patches. It can hit the host tool-call timeout even when DeepSeek is healthy. For implementation work, start an async job, keep the host agent productive, then review the final diff.

Recommended MCP pattern:

1. Call `deepseek_start_implementation` with a narrow `cwd`, `task`, `allowed_dirs`, `checks`, and `worker_profile`.
2. Keep the host agent responsible for planning and final review.
3. Use `deepseek_wait_for_job` for a short observation window, not as the worker lifetime limit.
4. Use `deepseek_get_job` with `include_diff: true` only at terminal state or final review.
5. If the job is still running, report progress and continue local non-overlapping work.

## Task Packet Template

Use this structure when calling DeepSeek:

```text
Task: <one concrete outcome>

Context:
- Repo/workspace: <path or project name>
- Relevant files: <files already inspected>
- Current behavior/problem: <brief facts>
- Desired behavior: <brief target>

Allowed changes:
- <specific files or directories>

Do not:
- Do not modify unrelated files.
- Do not introduce new dependencies unless explicitly necessary and explained.
- Do not rewrite architecture, routing, public APIs, database schema, or styling system unless listed in allowed changes.
- Do not delete tests to make validation pass.

Acceptance criteria:
- <observable behavior>
- <existing behavior that must remain unchanged>
- <tests/lint/build expectations>

Validation to run:
- <command 1>
- <command 2>

Output:
- Changed files
- Summary of implementation
- Validation results, including failures
- Any uncertainty or follow-up needed
```

## reasonix Usage

Use raw `reasonix` only when MCP worker tools are unavailable.

Prefer non-interactive execution for scoped tasks:

```bash
reasonix run --effort medium --budget 0.25 --transcript .codex-router/reasonix-<task>.jsonl '<task packet>'
```

For code-editing sessions where DeepSeek should use filesystem tools:

```bash
reasonix code /path/to/repo --effort medium --budget 0.50 --transcript .codex-router/reasonix-code.jsonl
```

If the task is very mechanical, use `--effort low`. If DeepSeek is only gathering information, cap the budget tightly. If a task needs more than medium effort, reconsider whether Codex/Claude should do it directly.

When using MCP tools with reasonix, pass the configured MCP server explicitly if the environment requires it:

```bash
reasonix run --mcp '<server-spec>' '<task packet>'
```

## Review Checklist

After DeepSeek returns, check:

- Scope: only intended files changed
- Behavior: acceptance criteria are actually met
- Architecture: no new unnecessary abstractions or boundary leaks
- Style: code follows local patterns
- Tests: relevant checks pass or failure is understood
- Risk: no accidental security, data, config, dependency, or API impact

Use this review stance:

```text
Review DeepSeek's diff as if it came from a fast junior engineer: helpful, but not authoritative.
Preserve useful work, fix small issues yourself, and delegate only one more focused correction when needed.
```

## Claude Code Compatibility

For Claude Code project rules, adapt this skill into a short instruction block:

```text
Act as the director and final reviewer. Delegate scoped, verifiable coding/search/debugging subtasks to DeepSeek via reasonix when they are low-risk and mechanical. Keep architecture, ambiguous decisions, visual judgment, difficult debugging, and final review in Claude Code. Every delegated task must include goal, allowed files, forbidden actions, acceptance criteria, validation commands, and output format. Never accept DeepSeek output without reviewing the diff and validation.
```

## Common Patterns

Small feature:

1. Codex/Claude reads the surrounding component and designs the minimal change.
2. DeepSeek implements only the named files.
3. Codex/Claude reviews visual/API consistency and runs checks.

Bug fix:

1. DeepSeek handles obvious lint/type/test failures with the exact error text.
2. Codex/Claude takes over when root cause is unclear, repeated, cross-module, or architectural.

Research:

1. DeepSeek gathers sources and summaries.
2. Codex/Claude checks source quality, resolves contradictions, and makes the recommendation.

Refactor:

1. Codex/Claude defines invariants, migration steps, and acceptance criteria.
2. DeepSeek performs repetitive edits in small batches.
3. Codex/Claude reviews each batch before continuing.
