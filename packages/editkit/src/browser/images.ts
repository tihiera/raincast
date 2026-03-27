// ---------------------------------------------------------------------------
// Image attachment helpers for multimodal LLM requests (browser-only)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 8 * 1024 * 1024 // 8 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

export type ImageValidation =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Validate that a File is an allowed image type and within size limits.
 */
export function validateImageFile(file: File, maxSize = DEFAULT_MAX_SIZE): ImageValidation {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, reason: `Unsupported type "${file.type}". Allowed: png, jpg, webp.` }
  }
  if (file.size > maxSize) {
    return {
      ok: false,
      reason: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${(maxSize / 1024 / 1024).toFixed(0)} MB.`,
    }
  }
  return { ok: true }
}

/**
 * Read a File into a data URL string.
 */
export async function fileToDataUrl(file: File): Promise<{ mime: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({ mime: file.type, dataUrl: reader.result as string })
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

/**
 * Extract the raw base64 payload and MIME type from a data URL.
 */
export function dataUrlToBase64(dataUrl: string): { mime: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error("Invalid data URL format")
  return { mime: match[1], base64: match[2] }
}
