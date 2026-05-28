#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_VERSION = "0.1.0";
const JOB_ROOT = process.env.REASONIX_MCP_JOB_ROOT || join(homedir(), ".codex", "reasonix-native-mcp", "jobs");
const DEFAULT_REASONIX_BIN = process.env.REASONIX_BIN || "reasonix";
const MAX_TAIL_CHARS = 12000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const jobs = new Map();

if (process.argv.includes("--doctor")) {
  await runDoctor();
  process.exit(0);
}

mkdirSync(JOB_ROOT, { recursive: true });

const server = new McpServer({
  name: "reasonix-native-mcp",
  version: SERVER_VERSION,
});

server.tool(
  "reasonix_start_task",
  "Start an async reasonix task and return a job_id immediately. Use for DeepSeek worker delegation without blocking the host agent.",
  {
    task: z.string().min(1).describe("Self-contained task packet for DeepSeek/reasonix."),
    cwd: z.string().optional().describe("Workspace directory. Defaults to current MCP process cwd."),
    mode: z.enum(["run"]).default("run").describe("Execution mode. Only non-interactive reasonix run is supported in this native worker."),
    model: z.string().optional().describe("Optional reasonix model id, for example deepseek-v4-flash."),
    effort: z.enum(["low", "medium", "high", "max"]).optional().describe("Reasoning effort passed to reasonix."),
    budget: z.number().positive().optional().describe("Optional USD budget cap passed to reasonix."),
    system: z.string().optional().describe("Optional system prompt override passed to reasonix run."),
    no_config: z.boolean().default(false).describe("Pass --no-config to reasonix."),
    no_proxy: z.boolean().default(false).describe("Pass --no-proxy to reasonix."),
    reasonix_bin: z.string().optional().describe("Path to reasonix executable. Defaults to REASONIX_BIN or reasonix."),
  },
  async (input) => {
    const job = startReasonixJob(input);
    return jsonResult({
      server_version: SERVER_VERSION,
      status: job.status,
      job_id: job.id,
      cwd: job.cwd,
      pid: job.pid,
      transcript_path: job.transcriptPath,
      log_path: job.logPath,
      message: "reasonix task started",
    });
  },
);

server.tool(
  "reasonix_get_task",
  "Read compact status/result for a reasonix task. Include logs only when needed for review or debugging.",
  {
    job_id: z.string(),
    include_logs: z.boolean().default(false),
  },
  async ({ job_id, include_logs }) => jsonResult(readJob(job_id, { includeLogs: include_logs })),
);

server.tool(
  "reasonix_tail_task",
  "Read recent stdout/stderr tail for a running reasonix task.",
  {
    job_id: z.string(),
  },
  async ({ job_id }) => jsonResult(readJob(job_id, { includeLogs: true, tailOnly: true })),
);

server.tool(
  "reasonix_wait_task",
  "Observe a reasonix task for a short foreground window. This does not control task lifetime.",
  {
    job_id: z.string(),
    max_wait_ms: z.number().min(100).max(120000).default(10000),
    poll_interval_ms: z.number().min(100).max(10000).default(1000),
    include_logs: z.boolean().default(false),
  },
  async ({ job_id, max_wait_ms, poll_interval_ms, include_logs }) => {
    const deadline = Date.now() + max_wait_ms;
    while (Date.now() < deadline) {
      const job = requireJob(job_id);
      if (TERMINAL.has(job.status)) {
        return jsonResult(readJob(job_id, { includeLogs: include_logs }));
      }
      await sleep(Math.min(poll_interval_ms, Math.max(100, deadline - Date.now())));
    }
    return jsonResult(readJob(job_id, { includeLogs: include_logs }));
  },
);

server.tool(
  "reasonix_cancel_task",
  "Cancel a running reasonix task.",
  {
    job_id: z.string(),
  },
  async ({ job_id }) => {
    const job = requireJob(job_id);
    if (job.child && !job.child.killed && !TERMINAL.has(job.status)) {
      job.status = "cancel_requested";
      job.updatedAt = new Date().toISOString();
      job.child.kill("SIGTERM");
      setTimeout(() => {
        if (job.child && !job.child.killed && !TERMINAL.has(job.status)) {
          job.child.kill("SIGKILL");
        }
      }, 3000).unref();
    }
    return jsonResult(readJob(job_id, { includeLogs: true }));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

function startReasonixJob(input) {
  const cwd = resolve(input.cwd || process.cwd());
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
  }
  const id = makeJobId();
  const jobDir = join(JOB_ROOT, id);
  mkdirSync(jobDir, { recursive: true });
  const transcriptPath = join(jobDir, "transcript.jsonl");
  const logPath = join(jobDir, "output.log");
  const reasonixBin = input.reasonix_bin || DEFAULT_REASONIX_BIN;
  const args = buildReasonixArgs(input, transcriptPath);
  const job = {
    id,
    status: "running",
    phase: "started",
    cwd,
    reasonixBin,
    args,
    pid: null,
    exitCode: null,
    signal: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    transcriptPath,
    logPath,
    stdout: "",
    stderr: "",
    child: null,
  };
  jobs.set(id, job);
  writeFileSync(logPath, "", "utf8");
  persistJob(job);

  const child = spawn(reasonixBin, args, { cwd, env: process.env });
  job.child = child;
  job.pid = child.pid || null;
  persistJob(job);

  child.stdout.on("data", (chunk) => appendOutput(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendOutput(job, "stderr", chunk));
  child.on("error", (error) => {
    job.status = "failed";
    job.phase = "spawn_error";
    job.stderr = trimTail(`${job.stderr}\n${error.message}`);
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    persistJob(job);
  });
  child.on("exit", (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.status = code === 0 ? "completed" : job.status === "cancel_requested" ? "cancelled" : "failed";
    job.phase = "finished";
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    persistJob(job);
  });

  return job;
}

function buildReasonixArgs(input, transcriptPath) {
  if ((input.mode || "run") !== "run") {
    throw new Error("Only mode=run is supported by reasonix-native-mcp 0.1.0");
  }
  const args = ["run"];
  if (input.model) args.push("--model", input.model);
  if (input.system) args.push("--system", input.system);
  if (input.effort) args.push("--effort", input.effort);
  if (input.budget) args.push("--budget", String(input.budget));
  args.push("--transcript", transcriptPath);
  if (input.no_config) args.push("--no-config");
  if (input.no_proxy) args.push("--no-proxy");
  args.push(input.task);
  return args;
}

function appendOutput(job, stream, chunk) {
  const text = chunk.toString("utf8");
  job[stream] = trimTail(job[stream] + text);
  job.updatedAt = new Date().toISOString();
  const prefix = stream === "stderr" ? "[stderr] " : "";
  appendFileSync(job.logPath, `${prefix}${text}`, "utf8");
  persistJob(job);
}

function readJob(jobId, options = {}) {
  const job = requireJob(jobId);
  const payload = {
    server_version: SERVER_VERSION,
    job_id: job.id,
    status: job.status,
    phase: job.phase,
    cwd: job.cwd,
    pid: job.pid,
    exit_code: job.exitCode,
    signal: job.signal,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    completed_at: job.completedAt,
    transcript_path: job.transcriptPath,
    log_path: job.logPath,
  };
  if (options.includeLogs) {
    payload.stdout_tail = job.stdout;
    payload.stderr_tail = job.stderr;
    payload.log_tail = trimTail(readFileIfExists(job.logPath));
  }
  if (options.tailOnly) {
    return {
      server_version: SERVER_VERSION,
      job_id: job.id,
      status: job.status,
      stdout_tail: job.stdout,
      stderr_tail: job.stderr,
      log_tail: trimTail(readFileIfExists(job.logPath)),
    };
  }
  return payload;
}

function requireJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Unknown job_id: ${jobId}`);
  return job;
}

function persistJob(job) {
  const data = {
    id: job.id,
    status: job.status,
    phase: job.phase,
    cwd: job.cwd,
    reasonixBin: job.reasonixBin,
    args: redactArgs(job.args),
    pid: job.pid,
    exitCode: job.exitCode,
    signal: job.signal,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    transcriptPath: job.transcriptPath,
    logPath: job.logPath,
  };
  writeFileSync(join(JOB_ROOT, job.id, "job.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function redactArgs(args) {
  return args.map((arg, index) => (args[index - 1] === "--budget" ? arg : arg));
}

function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function makeJobId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `rx-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimTail(text) {
  if (!text) return "";
  return text.length > MAX_TAIL_CHARS ? text.slice(-MAX_TAIL_CHARS) : text;
}

function readFileIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function runDoctor() {
  const reasonixBin = DEFAULT_REASONIX_BIN;
  console.log(`reasonix-native-mcp ${SERVER_VERSION}`);
  console.log(`job_root: ${JOB_ROOT}`);
  console.log(`reasonix_bin: ${reasonixBin}`);
  await new Promise((resolveDoctor) => {
    const child = spawn(reasonixBin, ["--version"], { env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("exit", (code) => {
      console.log(`reasonix_version_check: ${code === 0 ? "ok" : "failed"}`);
      if (output.trim()) console.log(output.trim());
      resolveDoctor();
    });
    child.on("error", (error) => {
      console.log(`reasonix_version_check: failed`);
      console.log(error.message);
      resolveDoctor();
    });
  });
}
