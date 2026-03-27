import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { resolveWithinRoot } from "./safePath.js"

export interface SnapshotManifest {
  snapshotId: string
  createdAt: string
  files: { path: string; existed: boolean; sha256?: string }[]
  meta?: Record<string, unknown>
}

function snapshotDir(root: string, id: string): string {
  return path.join(root, ".rain", "snapshots", id)
}

/**
 * Create a targeted snapshot of specific files.
 * Stores original bytes so they can be restored later.
 */
export function createSnapshot(
  root: string,
  filesRel: string[],
  meta?: Record<string, unknown>,
): string {
  const id = crypto.randomUUID()
  const dir = snapshotDir(root, id)
  fs.mkdirSync(dir, { recursive: true })

  const manifest: SnapshotManifest = {
    snapshotId: id,
    createdAt: new Date().toISOString(),
    files: [],
    meta,
  }

  for (const rel of filesRel) {
    const absPath = resolveWithinRoot(root, rel)
    let existed = false
    try {
      const stat = fs.statSync(absPath)
      existed = stat.isFile()
    } catch {
      // doesn't exist
    }

    if (existed) {
      const content = fs.readFileSync(absPath)
      const hash = crypto.createHash("sha256").update(content).digest("hex")

      // Store the file inside the snapshot dir at the same relative path
      const dest = path.join(dir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, content)

      manifest.files.push({ path: rel, existed: true, sha256: hash })
    } else {
      manifest.files.push({ path: rel, existed: false })
    }
  }

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))
  return id
}

/**
 * Restore a snapshot – brings every tracked file back to its pre-snapshot state.
 * Files that did not exist before the snapshot are deleted.
 */
export function restoreSnapshot(root: string, snapshotId: string): void {
  const dir = snapshotDir(root, snapshotId)
  const manifestPath = path.join(dir, "manifest.json")

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Snapshot ${snapshotId} not found`)
  }

  const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))

  for (const entry of manifest.files) {
    const absPath = resolveWithinRoot(root, entry.path)

    if (entry.existed) {
      // Restore original content
      const src = path.join(dir, entry.path)
      const content = fs.readFileSync(src)
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      fs.writeFileSync(absPath, content)
    } else {
      // File was created after snapshot – remove it
      try {
        fs.unlinkSync(absPath)
      } catch {
        // already gone
      }
    }
  }
}
