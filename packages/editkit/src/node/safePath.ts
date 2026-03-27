import path from "node:path"
import fs from "node:fs"
import { PathTraversal } from "../core/errors.js"

/**
 * Resolve `relPath` within `root`, ensuring the result never escapes root.
 *
 * Rejects:
 * - Absolute paths
 * - Null bytes
 * - Paths that resolve outside root (via .., symlinks, etc.)
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw new PathTraversal(relPath)
  if (relPath.includes("\0")) throw new PathTraversal(relPath)

  // Resolve root to its real path to handle symlinks (e.g. /var -> /private/var on macOS)
  let absRoot: string
  try {
    absRoot = fs.realpathSync(path.resolve(root))
  } catch {
    absRoot = path.resolve(root)
  }
  const resolved = path.resolve(absRoot, relPath)

  if (!resolved.startsWith(absRoot + path.sep) && resolved !== absRoot) {
    throw new PathTraversal(relPath)
  }

  // Check that existing parent dirs don't escape via symlinks
  let check = resolved
  while (check !== absRoot) {
    const parent = path.dirname(check)
    if (parent === check) break // filesystem root
    try {
      const real = fs.realpathSync(parent)
      if (!real.startsWith(absRoot) && real !== absRoot) {
        throw new PathTraversal(relPath)
      }
    } catch (e: any) {
      if (e instanceof PathTraversal) throw e
      // parent doesn't exist yet – that's fine, it will be created
      break
    }
    check = parent
  }

  return resolved
}
