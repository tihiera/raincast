# OpenCode Reference Notes

Notes from studying the OpenCode source code (anomalyco/opencode, `dev` branch) to inform `@rain/editkit` implementation.

## Files studied

- `packages/opencode/src/tool/edit.ts` — edit/replace tool
- `packages/opencode/src/snapshot/index.ts` — snapshot system

---

## A) Replacer chain order in OpenCode's edit.ts

OpenCode defines 9 replacer strategies, tried in this order:

1. **SimpleReplacer** – yields `find` as-is (exact substring match)
2. **LineTrimmedReplacer** – trims each line, compares trimmed
3. **BlockAnchorReplacer** – anchors on first/last non-empty lines (trimmed), scores middle via Levenshtein
4. **WhitespaceNormalizedReplacer** – collapses all whitespace to single space
5. **IndentationFlexibleReplacer** – strips common leading indent
6. **EscapeNormalizedReplacer** – interprets `\n`, `\t`, etc.
7. **TrimmedBoundaryReplacer** – trims leading/trailing blank lines from find
8. **ContextAwareReplacer** – similar to BlockAnchor but checks exact-match ratio of middle lines ≥50%
9. **MultiOccurrenceReplacer** – yields every exact occurrence (for replaceAll)

### Ambiguity handling

For each replacer, for each yielded candidate `search`:
- Look up `search` in `content` by `indexOf`
- If `replaceAll` → call `content.replaceAll(search, newString)` and return
- Otherwise, if `indexOf !== lastIndexOf` (multiple occurrences) → skip to next candidate/replacer
- If unique occurrence → replace and return

If all replacers exhaust without returning:
- If at least one candidate was found (but always had multiple occurrences) → throw "multiple matches" error
- If zero candidates found → throw "not found" error

### What we changed in @rain/editkit

- **Reordered** to: exact → lineTrimmed → indentationFlexible → whitespaceNormalized → escapeNormalized → trimmedBoundary → blockAnchor → multiOccurrence
  - Moved indentation-flexible before whitespace-normalized (more precise match first)
  - Dropped ContextAwareReplacer (redundant with BlockAnchor)
- **Typed errors**: `AmbiguousMatch`, `NotFound`, `InvalidPatch` instead of plain `Error`
- **Explicit matchCount** returned alongside strategy name

---

## B) BlockAnchor strategy and similarity scoring

### Algorithm

1. Requires at least 3 search lines (first, last, ≥1 middle)
2. **Anchor extraction**: first and last non-empty lines, trimmed
3. **Candidate scanning**: iterate content lines; for each line matching first anchor, find the first line below matching last anchor → candidate block `[startLine, endLine]`
4. **Similarity scoring** (middle lines only):
   - For each pair of middle lines (search vs content), compute: `1 - levenshtein(a.trim(), b.trim()) / max(a.len, b.len)`
   - Average over `min(searchMiddle, contentMiddle)` lines
5. **Thresholds**:
   - Single candidate: threshold = **0.0** (very relaxed — just requires anchors to match)
   - Multiple candidates: threshold = **0.3** (picks best above threshold)

### What we kept

Replicated the exact algorithm with the same thresholds. Implemented Levenshtein ourselves (O(min(n,m)) space single-row variant) instead of adding a dependency.

---

## C) Snapshot approach

### OpenCode's approach

OpenCode uses a **separate git directory** (`$DATA_DIR/snapshot/<projectId>/`) alongside the project's working tree:

- `git init` into the separate git-dir
- `git add .` → `git write-tree` to capture a tree hash
- Restore: `git read-tree <hash>` → `git checkout-index -a -f` (whole-repo force-checkout)
- Revert per-file: `git checkout <hash> -- <file>` with fallback to `git ls-tree` + delete
- Periodic `git gc --prune=7.days`

This means snapshots capture the **entire working tree** and restores are whole-repo.

### What we changed — targeted snapshots

`@rain/editkit` implements **targeted file snapshots**:

- Only files actually touched by a patch plan are included in the snapshot
- Stored in `<root>/.rain/snapshots/<uuid>/`
- A `manifest.json` records: `snapshotId`, `createdAt`, per-file `{path, existed, sha256}`
- Original file bytes stored at the same relative path inside the snapshot directory
- Restore:
  - If `existed=true` → copy bytes back
  - If `existed=false` → delete the file (undo creation)

**Trade-offs**:
- Pro: much smaller snapshots, no git dependency, instant restore for small patches
- Con: does not capture files modified outside the patch plan; not suitable as whole-repo versioning
- This is intentional: the snapshot is an undo mechanism for `applyPatchPlan`, not a VCS replacement
