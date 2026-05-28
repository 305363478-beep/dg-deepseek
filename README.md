# dg-deepseek

`dg-deepseek` is a Codex Skill for saving Codex and Claude Code tokens by delegating scoped execution work to DeepSeek through the `reasonix` CLI.

Use Codex or Claude Code for planning, architecture, difficult debugging, frontend judgment, and final review. Use DeepSeek for mechanical implementation, small UI changes, ordinary error fixes, boilerplate, repetitive edits, and first-pass research.

## Daily Trigger

```text
用 dg-deepseek 做这个
```

or:

```text
按 dg-deepseek 工作流处理
```

## Install

Copy the skill folder into your Codex skills directory:

```bash
cp -R dg-deepseek ~/.codex/skills/dg-deepseek
```

## reasonix-native MCP

This repo also includes a native MCP server that calls `reasonix` directly instead of routing through Claude Code CLI:

```bash
npm install
npm run mcp:doctor
```

Codex config:

```toml
[mcp_servers.reasonix-native]
command = "node"
args = ["/absolute/path/to/dg-deepseek/reasonix-native-mcp/bin/reasonix-native-mcp.mjs"]
```

Tools exposed:

- `reasonix_start_task`
- `reasonix_wait_task`
- `reasonix_get_task`
- `reasonix_tail_task`
- `reasonix_cancel_task`

Use `reasonix_start_task` first. It returns a `job_id` immediately so Codex or Claude Code does not block on a long DeepSeek run.

## Core Idea

DeepSeek does the labor. Codex and Claude Code keep the judgment.

The workflow is:

1. Codex/Claude reads the code and designs the plan.
2. Codex/Claude sends a scoped task packet to DeepSeek via `reasonix`.
3. DeepSeek performs the local, verifiable work.
4. Codex/Claude reviews the diff, validation output, and merge risk.

This keeps expensive reasoning-model context focused on decisions that actually need it.
