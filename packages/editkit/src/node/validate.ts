import { spawnSync } from "node:child_process"
import { UnsafeCommand } from "../core/errors.js"

const ALLOWED_PREFIXES = ["npm ", "pnpm ", "npx ", "node ", "tsc ", "eslint ", "vitest "]
const TAIL_LINES = 50

export interface ValidationResult {
  ok: boolean
  exitCode: number
  stdoutTail: string
  stderrTail: string
}

/**
 * Run validation command(s) with a strict allowlist.
 */
export function runValidation(root: string, commands: string[]): ValidationResult {
  for (const cmd of commands) {
    if (!ALLOWED_PREFIXES.some((p) => cmd.startsWith(p))) {
      throw new UnsafeCommand(cmd)
    }

    const result = spawnSync(cmd, {
      cwd: root,
      shell: true,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    })

    const exitCode = result.status ?? 1
    if (exitCode !== 0) {
      return {
        ok: false,
        exitCode,
        stdoutTail: tail(result.stdout ?? "", TAIL_LINES),
        stderrTail: tail(result.stderr ?? "", TAIL_LINES),
      }
    }
  }

  return { ok: true, exitCode: 0, stdoutTail: "", stderrTail: "" }
}

function tail(text: string, n: number): string {
  const lines = text.split("\n")
  return lines.slice(-n).join("\n")
}
