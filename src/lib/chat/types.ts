/** An image attachment embedded in a chat message. */
export interface ImageAttachment {
  /** MIME type: image/png, image/jpeg, image/webp */
  mime: string;
  /** Raw base64 data (no data: prefix) */
  base64: string;
  /** Data URL for rendering in the UI */
  dataUrl: string;
  /** If this image originated from the sketch canvas, JSON-serialized CanvasData for re-editing. */
  canvasData?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "status";
  content: string;
  /** Optional image attachments (screenshots, mockups, etc.) */
  images?: ImageAttachment[];
  /** For status messages: structured data for rendering. */
  statusData?: {
    type: "plan" | "progress" | "success" | "error" | "name-picker" | "logo-picker";
    tasks?: Array<{ file: string; description: string }>;
    label?: string;
    detail?: string;
    /** App name suggestions for the name-picker type. */
    nameSuggestions?: string[];
    /** SVG logo variants for the logo-picker type. */
    logoSvgs?: string[];
  };
}
