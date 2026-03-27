import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { CanvasData } from "./types";
import type { ImageAttachment } from "../chat/types";

interface SketchContextValue {
  isOpen: boolean;
  /** If re-editing, the strokes to restore. */
  initialData: CanvasData | null;
  /** Image waiting to be consumed by ChatPane. */
  pendingInsert: ImageAttachment | null;
  openSketch: (data?: CanvasData) => void;
  closeSketch: () => void;
  /** Called by SketchCanvas when user clicks Insert. */
  insertImage: (img: ImageAttachment) => void;
  /** Called by ChatPane after adding the image to pendingImages. */
  consumeInsert: () => void;
}

const SketchCtx = createContext<SketchContextValue>(null!);

export function SketchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialData, setInitialData] = useState<CanvasData | null>(null);
  const [pendingInsert, setPendingInsert] = useState<ImageAttachment | null>(null);

  const openSketch = useCallback((data?: CanvasData) => {
    setInitialData(data ?? null);
    setIsOpen(true);
  }, []);

  const closeSketch = useCallback(() => {
    setIsOpen(false);
    setInitialData(null);
  }, []);

  const insertImage = useCallback((img: ImageAttachment) => {
    setPendingInsert(img);
    setIsOpen(false);
    setInitialData(null);
  }, []);

  const consumeInsert = useCallback(() => {
    setPendingInsert(null);
  }, []);

  return (
    <SketchCtx.Provider value={{ isOpen, initialData, pendingInsert, openSketch, closeSketch, insertImage, consumeInsert }}>
      {children}
    </SketchCtx.Provider>
  );
}

export function useSketchContext() {
  return useContext(SketchCtx);
}
