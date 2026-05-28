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

## Core Idea

DeepSeek does the labor. Codex and Claude Code keep the judgment.

The workflow is:

1. Codex/Claude reads the code and designs the plan.
2. Codex/Claude sends a scoped task packet to DeepSeek via `reasonix`.
3. DeepSeek performs the local, verifiable work.
4. Codex/Claude reviews the diff, validation output, and merge risk.

This keeps expensive reasoning-model context focused on decisions that actually need it.
