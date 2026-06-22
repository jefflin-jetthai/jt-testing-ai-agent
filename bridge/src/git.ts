/**
 * Git 操作（在 AT repo 內）。建立本地 commit，**不自動 push**；push 為獨立明確動作。
 */
import { spawn } from "node:child_process";
import { AT_REPO_PATH } from "./config.js";

function git(args: string[], cwd = AT_REPO_PATH): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) => resolve({ code: 1, stdout, stderr: stderr + e.message }));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function currentBranch(cwd = AT_REPO_PATH): Promise<string> {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return r.stdout.trim();
}

/** porcelain 狀態（限定 tests/ 與 specs/ 路徑，避免動到無關檔案）。 */
export async function changedTestFiles(cwd = AT_REPO_PATH): Promise<string[]> {
  const r = await git(
    ["status", "--porcelain", "--untracked-files=all", "--", "tests/", "specs/"],
    cwd,
  );
  return r.stdout
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

export async function diff(files: string[], cwd = AT_REPO_PATH): Promise<string> {
  const r = await git(["diff", "--", ...files], cwd);
  return r.stdout;
}

export interface CommitArgs {
  message: string;
  files: string[]; // 只 stage 這些檔案
  branch?: string; // 提供則先 checkout -b
  cwd?: string;
}

/** 建立本地 commit（不 push）。回傳 commit hash 與所在分支。 */
export async function createCommit(
  args: CommitArgs,
): Promise<{ ok: boolean; branch: string; hash?: string; error?: string }> {
  const cwd = args.cwd ?? AT_REPO_PATH;
  if (!args.files.length) return { ok: false, branch: await currentBranch(cwd), error: "沒有要提交的檔案" };

  if (args.branch) {
    const co = await git(["checkout", "-b", args.branch], cwd);
    if (co.code !== 0) {
      // 分支已存在則切過去
      const co2 = await git(["checkout", args.branch], cwd);
      if (co2.code !== 0) return { ok: false, branch: args.branch, error: co.stderr || co2.stderr };
    }
  }

  const add = await git(["add", "--", ...args.files], cwd);
  if (add.code !== 0) return { ok: false, branch: await currentBranch(cwd), error: add.stderr };

  const commit = await git(["commit", "-m", args.message], cwd);
  const branch = await currentBranch(cwd);
  if (commit.code !== 0) return { ok: false, branch, error: commit.stderr || commit.stdout };

  const hash = (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
  return { ok: true, branch, hash };
}

/** 明確 push（使用者於 UI 觸發）。 */
export async function push(
  branch?: string,
  cwd = AT_REPO_PATH,
): Promise<{ ok: boolean; output: string }> {
  const b = branch ?? (await currentBranch(cwd));
  const r = await git(["push", "-u", "origin", b], cwd);
  return { ok: r.code === 0, output: r.stdout + r.stderr };
}
