// ---------------------------------------------------------------------------
// Simple heuristic to detect "make UI look like this" intent
// ---------------------------------------------------------------------------

const UI_MOCK_PATTERNS = [
  /\b(?:make|build|create|implement|code)\b.*\b(?:look|match|resemble)\b.*\b(?:this|image|screenshot|mock|design|mockup|wireframe)\b/i,
  /\b(?:screenshot|mockup|wireframe|design|ui\s*mock|figma)\b/i,
  /\b(?:replicate|reproduce|copy)\b.*\b(?:ui|layout|design|interface)\b/i,
  /\bui\s*from\s*image\b/i,
  /\bmatch\s*(?:this|the)\s*(?:design|screenshot|image|mock)\b/i,
]

/**
 * Returns true if the text probably asks for "make the UI look like this
 * screenshot / mock / design".
 */
export function isProbablyUiMockInstruction(text: string): boolean {
  return UI_MOCK_PATTERNS.some((re) => re.test(text))
}
