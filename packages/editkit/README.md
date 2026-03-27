# @rain/editkit

A slim, zero-heavy-dependency editing engine for **Raincast** — a Tauri app that uses LLMs to generate and apply code patches.

Implements four core capabilities:

1. **Robust search/replace** — multi-strategy replacer chain (exact → fuzzy → block-anchor)
2. **Self-healing loop** — apply → validate → propose fix → retry
3. **Targeted snapshots** — undo/redo for only the files a patch touches
4. **Multimodal helpers** — image attachment utilities for "UI from screenshot" workflows

## Install

```bash
npm install @rain/editkit
```

## Exports

| Entry point          | Description                              |
|---------------------|------------------------------------------|
| `@rain/editkit`      | Everything                               |
| `@rain/editkit/core` | Pure functions (no fs, no DOM)           |
| `@rain/editkit/node` | Node.js executors (fs, child_process)    |
| `@rain/editkit/browser` | Browser helpers (File → base64)       |
| `@rain/editkit/prompts` | LLM prompt/schema builders            |

## API Examples

### replaceBlock

```ts
import { replaceBlock } from "@rain/editkit/core"

const result = replaceBlock(
  fileContent,
  "const x = 1",
  "const x = 2",
)
// result.updated  — new file content
// result.strategy — which replacer matched (e.g. "exact", "blockAnchor")
// result.matchCount — number of replacements made
```

Strategies tried in order: exact, lineTrimmed, indentationFlexible, whitespaceNormalized, escapeNormalized, trimmedBoundary, blockAnchor, multiOccurrence.

### Parsing patch plans

```ts
import { parsePatchBlocks, parsePatchJson } from "@rain/editkit/core"

// From RAIN_EDIT block format (preferred for LLM output)
const plan = parsePatchBlocks(`
>>>RAIN_EDIT path="src/app.ts" kind="replaceBlock"
>>>OLD
const port = 3000
>>>NEW
const port = 8080
>>>END
`)

// From JSON (also supports fenced code blocks)
const plan2 = parsePatchJson('{"ops":[{"kind":"replaceBlock","path":"src/app.ts","old":"const port = 3000","new":"const port = 8080"}]}')
```

### Targeted snapshots

```ts
import { createSnapshot, restoreSnapshot, applyPatchPlan } from "@rain/editkit/node"

// Manual snapshot
const id = createSnapshot("/path/to/project", ["src/app.ts", "src/config.ts"])
// ... make changes ...
restoreSnapshot("/path/to/project", id)  // reverts those files

// Or let applyPatchPlan handle it automatically
const { snapshotId, changedFiles } = applyPatchPlan("/path/to/project", plan)
// To undo: restoreSnapshot("/path/to/project", snapshotId)
```

### Self-healing loop

```ts
import { runSelfHeal } from "@rain/editkit/node"

const result = await runSelfHeal({
  root: "/path/to/project",
  initialPlan: plan,
  validateCommands: ["npx tsc --noEmit", "vitest run"],
  proposeFix: async (ctx) => {
    // ctx.stderrTail, ctx.stdoutTail, ctx.planSummary, ctx.changedFiles
    // Call your LLM here and return a new PatchPlan
    return await askLlmForFix(ctx)
  },
  maxIters: 5,
})
// result.ok, result.iters, result.snapshots
```

### UI-from-image request builder

```ts
import { buildUiFromImageRequest } from "@rain/editkit/prompts"
import { dataUrlToBase64 } from "@rain/editkit/browser"

// In browser: convert user-uploaded file
const { mime, base64 } = dataUrlToBase64(dataUrl)

// Build a provider-agnostic request
const req = buildUiFromImageRequest({
  userText: "Make the sidebar match this design",
  images: [{ mime, base64 }],
  repoHints: "React + Tailwind project, components in src/components/",
  outputFormat: "blocks",
})
// req.system  — system prompt
// req.user    — user message with repo context
// req.images  — image payloads ready for any multimodal API
```

## Development

```bash
npm run build      # Build with tsup → dist/
npm test           # Run tests (vitest watch mode)
npx vitest run     # Run tests once
npm run typecheck   # TypeScript type checking
```

## Architecture

See [docs/REFERENCE.md](docs/REFERENCE.md) for notes on the OpenCode algorithms this library is based on and what was changed.
