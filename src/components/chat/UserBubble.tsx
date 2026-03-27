import { useState, useCallback } from "react";
import { Copy, Check, X, PenTool } from "lucide-react";
import type { ImageAttachment } from "../../lib/chat/types";
import { useSketchContext } from "../../lib/sketch/SketchContext";
import type { CanvasData } from "../../lib/sketch/types";

interface Props {
  content: string;
  images?: ImageAttachment[];
}

export default function UserBubble({ content, images }: Props) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { openSketch } = useSketchContext();

  const handleEditSketch = useCallback((img: ImageAttachment) => {
    if (!img.canvasData) return;
    try {
      const data: CanvasData = JSON.parse(img.canvasData);
      openSketch(data);
    } catch { /* ignore parse errors */ }
  }, [openSketch]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div
      className="flex justify-end my-8"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setCopied(false); }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: "85%",
          padding: "10px 16px",
          borderRadius: 16,
          borderBottomRightRadius: 4,
          background: "var(--subtle-bg)",
          color: "var(--text-primary)",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {/* Attached images */}
        {images && images.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: "relative", display: "inline-block" }}>
                <img
                  src={img.dataUrl}
                  alt={`Attachment ${i + 1}`}
                  onClick={() => setPreviewIndex(i)}
                  style={{
                    maxWidth: 240,
                    maxHeight: 180,
                    borderRadius: 10,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />
                {img.canvasData && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleEditSketch(img); }}
                    title="Edit sketch"
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 6,
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <PenTool size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {content}
        <button
          type="button"
          onClick={handleCopy}
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            opacity: hovered ? 1 : 0,
            transition: "opacity 150ms ease",
            background: "var(--subtle-bg)",
            border: "none",
            padding: 4,
            borderRadius: 6,
            cursor: "pointer",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Copy message"
        >
          {copied
            ? <Check size={13} strokeWidth={1.8} />
            : <Copy size={13} strokeWidth={1.8} />}
        </button>
      </div>

      {/* Lightbox preview */}
      {previewIndex !== null && images?.[previewIndex] && (
        <div
          onClick={() => setPreviewIndex(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0,0,0,0.15)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "85vw",
              maxHeight: "80vh",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              cursor: "default",
            }}
          >
            <img
              src={images[previewIndex].dataUrl}
              alt="Preview"
              style={{
                display: "block",
                maxWidth: "85vw",
                maxHeight: "80vh",
                objectFit: "contain",
              }}
            />
            <button
              onClick={() => setPreviewIndex(null)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
