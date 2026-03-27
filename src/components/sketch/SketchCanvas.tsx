import { useRef, useState, useEffect, useCallback } from "react";
import { Pencil, Eraser, Undo2, Redo2, Trash2, X, ArrowRight } from "lucide-react";
import type { CanvasStroke, CanvasData } from "../../lib/sketch/types";
import type { ImageAttachment } from "../../lib/chat/types";

interface Props {
  initialData: CanvasData | null;
  onInsert: (img: ImageAttachment) => void;
  onClose: () => void;
}

type Tool = "pencil" | "eraser";

// ── Template definitions (normalized 0–1 coordinates) ─────────────────

interface TemplateInfo {
  label: string;
  description: string;
  generate: (w: number, h: number) => CanvasStroke[];
}

function rect(x: number, y: number, w: number, h: number, color?: string, width = 1.5): CanvasStroke {
  const c = color ?? getThemeColors().templateColor;
  return {
    tool: "pencil", color: c, width,
    points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]],
  };
}

function line(x1: number, y1: number, x2: number, y2: number, color?: string, width = 1): CanvasStroke {
  const c = color ?? getThemeColors().templateLineColor;
  return { tool: "pencil", color: c, width, points: [[x1, y1], [x2, y2]] };
}

const TEMPLATES: TemplateInfo[] = [
  {
    label: "Dashboard",
    description: "Sidebar + header + card grid",
    generate: (w, h) => {
      const s = 0.22 * w; // sidebar width
      const hh = 0.1 * h; // header height
      return [
        rect(8, 8, s - 8, h - 16),                      // sidebar
        rect(s + 8, 8, w - s - 16, hh),                  // header
        rect(s + 8, hh + 16, (w - s - 24) / 2, (h - hh - 32) / 2), // card TL
        rect(s + 16 + (w - s - 24) / 2, hh + 16, (w - s - 24) / 2, (h - hh - 32) / 2), // card TR
        rect(s + 8, hh + 24 + (h - hh - 32) / 2, (w - s - 24) / 2, (h - hh - 32) / 2), // card BL
        rect(s + 16 + (w - s - 24) / 2, hh + 24 + (h - hh - 32) / 2, (w - s - 24) / 2, (h - hh - 32) / 2), // card BR
      ];
    },
  },
  {
    label: "Chat",
    description: "Conversation list + messages",
    generate: (w, h) => {
      const lw = 0.28 * w; // list width
      const ib = 48; // input bar height
      return [
        rect(8, 8, lw - 8, h - 16),                      // conversation list
        rect(lw + 8, 8, w - lw - 16, h - ib - 20),       // message area
        rect(lw + 8, h - ib - 4, w - lw - 16, ib - 4),   // input bar
        // list items
        ...Array.from({ length: 5 }, (_, i) =>
          line(16, 40 + i * 40, lw - 16, 40 + i * 40, undefined, 1)
        ),
      ];
    },
  },
  {
    label: "Editor",
    description: "Toolbar + canvas + side panel",
    generate: (w, h) => {
      const tb = 44; // toolbar height
      const pw = 0.25 * w; // panel width
      return [
        rect(8, 8, w - 16, tb),                           // toolbar
        rect(8, tb + 16, w - pw - 20, h - tb - 24),       // canvas
        rect(w - pw - 4, tb + 16, pw - 4, h - tb - 24),   // side panel
        // toolbar items
        ...Array.from({ length: 4 }, (_, i) =>
          rect(16 + i * 36, 16, 28, 28, undefined, 1)
        ),
      ];
    },
  },
];

// ── Redraw helper ─────────────────────────────────────────────────────

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const paneBg = style.getPropertyValue("--pane-bg").trim();
  // Detect dark mode: midnight theme has dark pane-bg
  const isDark = paneBg.startsWith("#2") || paneBg.startsWith("#1") || paneBg.startsWith("rgb(4");
  return {
    canvasBg: isDark ? "#1e1e1e" : "#fafafa",
    dotColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)",
    eraserColor: isDark ? "#1e1e1e" : "#fafafa",
    strokeColor: isDark ? "#d4d4d4" : "#333",
    templateColor: isDark ? "#666" : "#999",
    templateLineColor: isDark ? "#555" : "#ccc",
  };
}

function redrawCanvas(ctx: CanvasRenderingContext2D, strokes: CanvasStroke[], w: number, h: number, dpr: number) {
  const theme = getThemeColors();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, w, h);

  // subtle dot grid
  ctx.fillStyle = theme.dotColor;
  const spacing = 24;
  for (let x = spacing; x < w; x += spacing) {
    for (let y = spacing; y < h; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // draw strokes
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.tool === "eraser" ? theme.eraserColor : stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pts = stroke.points;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const mx = (prev[0] + curr[0]) / 2;
      const my = (prev[1] + curr[1]) / 2;
      ctx.quadraticCurveTo(prev[0], prev[1], mx, my);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// ── Thumbnail drawer ──────────────────────────────────────────────────

function drawThumbnail(canvas: HTMLCanvasElement, template: TemplateInfo) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const strokes = template.generate(w, h);
  redrawCanvas(ctx, strokes, w, h, dpr);
}

// ── Main Component ────────────────────────────────────────────────────

export default function SketchCanvas({ initialData, onInsert, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [strokes, setStrokes] = useState<CanvasStroke[]>(initialData?.strokes ?? []);
  const [undoneStrokes, setUndoneStrokes] = useState<CanvasStroke[]>([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<CanvasStroke | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  // Initialize canvas size
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      const ctx = canvas.getContext("2d");
      if (ctx) redrawCanvas(ctx, strokes, w, h, dpr);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw when strokes change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    redrawCanvas(ctx, strokes, w, h, dpr);
  }, [strokes]);

  // ── Drawing handlers ──────────────────────────────────────────────

  const getPos = useCallback((e: React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    drawingRef.current = true;
    const pos = getPos(e);
    const theme = getThemeColors();
    currentStrokeRef.current = {
      tool,
      color: tool === "eraser" ? theme.eraserColor : theme.strokeColor,
      width: tool === "eraser" ? 20 : 2,
      points: [pos],
    };
  }, [tool, getPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    const pos = getPos(e);
    currentStrokeRef.current.points.push(pos);

    // Draw incrementally for responsiveness
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pts = currentStrokeRef.current.points;
    const stroke = currentStrokeRef.current;

    const theme = getThemeColors();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.strokeStyle = stroke.tool === "eraser" ? theme.eraserColor : stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pts.length >= 2) {
      const prev = pts[pts.length - 2];
      const curr = pts[pts.length - 1];
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(curr[0], curr[1]);
    }
    ctx.stroke();
    ctx.restore();
  }, [getPos]);

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    drawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (stroke.points.length >= 2) {
      setStrokes((prev) => [...prev, stroke]);
      setUndoneStrokes([]); // new stroke clears redo
    }
  }, []);

  // ── Actions ───────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoneStrokes((u) => [...u, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setUndoneStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setStrokes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
    setUndoneStrokes([]);
  }, []);

  const handleTemplate = useCallback((template: TemplateInfo) => {
    const { w, h } = sizeRef.current;
    const templateStrokes = template.generate(w, h);
    setStrokes(templateStrokes);
    setUndoneStrokes([]);
  }, []);

  const handleInsert = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;

    // Export canvas to PNG
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

    const img: ImageAttachment = {
      mime: "image/png",
      base64,
      dataUrl,
      canvasData: JSON.stringify({ strokes } satisfies CanvasData),
    };
    onInsert(img);
  }, [strokes, onInsert]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  const canUndo = strokes.length > 0;
  const canRedo = undoneStrokes.length > 0;
  const hasContent = strokes.length > 0;

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--pane-bg)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)" }}>
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "8px 12px",
        borderBottom: "1px solid var(--separator-color)",
      }}>
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginRight: 8,
        }}>
          Draw anything
        </span>

        <div style={{ width: 1, height: 20, background: "var(--separator-color)", margin: "0 4px" }} />

        <ToolBtn
          icon={<Pencil size={15} strokeWidth={1.8} />}
          label="Pencil"
          active={tool === "pencil"}
          onClick={() => setTool("pencil")}
        />
        <ToolBtn
          icon={<Eraser size={15} strokeWidth={1.8} />}
          label="Eraser"
          active={tool === "eraser"}
          onClick={() => setTool("eraser")}
        />

        <div style={{ width: 1, height: 20, background: "var(--separator-color)", margin: "0 6px" }} />

        <ToolBtn
          icon={<Undo2 size={15} strokeWidth={1.8} />}
          label="Undo"
          disabled={!canUndo}
          onClick={handleUndo}
        />
        <ToolBtn
          icon={<Redo2 size={15} strokeWidth={1.8} />}
          label="Redo"
          disabled={!canRedo}
          onClick={handleRedo}
        />
        <ToolBtn
          icon={<Trash2 size={15} strokeWidth={1.8} />}
          label="Clear"
          disabled={!hasContent}
          onClick={handleClear}
        />

        <div style={{ flex: 1 }} />

        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
          title="Close sketch"
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* ── Canvas area ──────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          margin: 8,
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--separator-color)",
          cursor: tool === "eraser"
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='10' cy='10' r='9' fill='none' stroke='%23999' stroke-width='1'/%3E%3C/svg%3E\") 10 10, auto"
            : "crosshair",
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ display: "block" }}
        />
      </div>

      {/* ── Bottom bar: templates + insert ────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "8px 12px 12px",
        borderTop: "1px solid var(--separator-color)",
      }}>
        {/* Templates */}
        <div style={{ display: "flex", gap: 8, flex: 1 }}>
          {TEMPLATES.map((tmpl) => (
            <TemplateThumbnail
              key={tmpl.label}
              template={tmpl}
              onClick={() => handleTemplate(tmpl)}
            />
          ))}
        </div>

        {/* Insert button */}
        <button
          onClick={handleInsert}
          disabled={!hasContent}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 10,
            border: "none",
            background: hasContent ? "var(--slider-thumb)" : "var(--btn-muted-bg)",
            color: hasContent ? "#fff" : "var(--btn-muted-text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: hasContent ? "pointer" : "default",
            transition: "opacity 0.15s",
          }}
        >
          Insert
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function ToolBtn({ icon, label, active, disabled, onClick }: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "none",
        background: active ? "var(--btn-subtle-hover-bg)" : "transparent",
        color: disabled
          ? "var(--text-tertiary)"
          : active
            ? "var(--slider-thumb)"
            : "var(--text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {icon}
    </button>
  );
}

function TemplateThumbnail({ template, onClick }: { template: TemplateInfo; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawThumbnail(canvasRef.current, template);
  }, [template]);

  return (
    <button
      onClick={onClick}
      title={template.description}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: 0,
        border: "1px solid var(--separator-color)",
        borderRadius: 8,
        background: "var(--pane-bg)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--slider-thumb)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--separator-color)"; }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: 120, height: 72, display: "block" }}
      />
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        color: "var(--text-tertiary)",
        padding: "0 6px 4px",
      }}>
        {template.label}
      </span>
    </button>
  );
}
