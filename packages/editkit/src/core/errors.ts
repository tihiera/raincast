// ---------------------------------------------------------------------------
// Typed errors for @rain/editkit
// ---------------------------------------------------------------------------

export class AmbiguousMatch extends Error {
  readonly code = "AMBIGUOUS_MATCH" as const
  constructor(count: number) {
    super(`Found ${count} matches – provide more context to disambiguate.`)
    this.name = "AmbiguousMatch"
  }
}

export class NotFound extends Error {
  readonly code = "NOT_FOUND" as const
  constructor() {
    super(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
    this.name = "NotFound"
  }
}

export class InvalidPatch extends Error {
  readonly code = "INVALID_PATCH" as const
  constructor(reason: string) {
    super(reason)
    this.name = "InvalidPatch"
  }
}

export class UnsafeCommand extends Error {
  readonly code = "UNSAFE_COMMAND" as const
  constructor(cmd: string) {
    super(`Command not on allowlist: ${cmd}`)
    this.name = "UnsafeCommand"
  }
}

export class PathTraversal extends Error {
  readonly code = "PATH_TRAVERSAL" as const
  constructor(p: string) {
    super(`Path escapes root: ${p}`)
    this.name = "PathTraversal"
  }
}
