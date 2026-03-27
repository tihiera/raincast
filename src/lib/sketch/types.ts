export interface CanvasStroke {
  tool: "pencil" | "eraser";
  color: string;
  width: number;
  points: [number, number][];
}

/** Serializable canvas state for re-editing. */
export interface CanvasData {
  strokes: CanvasStroke[];
}
