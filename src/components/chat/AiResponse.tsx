import { useRef, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface AiResponseProps {
  content: string;
  isStreaming?: boolean;
  isThinking?: boolean;
}

const StreamCtx = createContext<{ revealed: number; counter: { current: number } } | null>(null);

function StreamingText({ children }: { children?: React.ReactNode }) {
  const ctx = useContext(StreamCtx);
  if (!ctx || typeof children !== "string") return <>{children}</>;

  const words = children.match(/\S+\s*/g);
  if (!words) return <>{children}</>;

  return (
    <>
      {words.map((word) => {
        const idx = ctx.counter.current++;
        const isNew = idx >= ctx.revealed;
        return (
          <span key={idx} className={isNew ? "ai-word-fade-in" : undefined}>
            {word}
          </span>
        );
      })}
    </>
  );
}

export default function AiResponse({ content, isStreaming, isThinking }: AiResponseProps) {
  const revealedWords = useRef(0);
  const renderCounter = useRef(0);

  useEffect(() => {
    if (isStreaming) {
      revealedWords.current = renderCounter.current;
    }
  });

  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    if (!wasStreaming.current && isStreaming) {
      revealedWords.current = 0;
    }
    if (wasStreaming.current && !isStreaming) {
      revealedWords.current = renderCounter.current;
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  const makeComponents = useCallback(
    (streaming: boolean) => {
      const textWrapper = streaming ? StreamingText : undefined;

      return {
        ...(textWrapper ? { text: textWrapper } : {}),
        p: ({ children }: { children?: React.ReactNode }) => (
          <p style={{ color: "var(--text-primary)", fontSize: 14, lineHeight: 1.55, marginBottom: 4 }}>{children}</p>
        ),
        strong: ({ children }: { children?: React.ReactNode }) => (
          <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>{children}</strong>
        ),
        em: ({ children }: { children?: React.ReactNode }) => (
          <em style={{ color: "var(--text-primary)" }}>{children}</em>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => (
          <ul style={{ paddingLeft: 16, marginBottom: 4 }}>{children}</ul>
        ),
        ol: ({ children }: { children?: React.ReactNode }) => (
          <ol style={{ paddingLeft: 16, marginBottom: 4 }}>{children}</ol>
        ),
        li: ({ children }: { children?: React.ReactNode }) => (
          <li style={{ color: "var(--text-primary)", fontSize: 14, lineHeight: 1.55, marginBottom: 4 }}>{children}</li>
        ),
        h1: ({ children }: { children?: React.ReactNode }) => (
          <h1 style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 18, marginTop: 12, marginBottom: 4 }}>{children}</h1>
        ),
        h2: ({ children }: { children?: React.ReactNode }) => (
          <h2 style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 16, marginTop: 10, marginBottom: 4 }}>{children}</h2>
        ),
        h3: ({ children }: { children?: React.ReactNode }) => (
          <h3 style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15, marginTop: 8, marginBottom: 4 }}>{children}</h3>
        ),
        code: ({ children }: { children?: React.ReactNode }) => (
          <code style={{ background: "var(--subtle-bg)", padding: "1px 5px", borderRadius: 4, fontSize: 13, color: "var(--text-primary)" }}>{children}</code>
        ),
        pre: ({ children }: { children?: React.ReactNode }) => (
          <pre style={{ background: "var(--subtle-bg)", padding: 12, borderRadius: 8, overflow: "auto", fontSize: 13, marginBottom: 8 }}>{children}</pre>
        ),
        table: ({ children }: { children?: React.ReactNode }) => (
          <div style={{ overflowX: "auto", marginBottom: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: "var(--text-primary)" }}>{children}</table>
          </div>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => (
          <thead style={{ borderBottom: "2px solid var(--separator-color)" }}>{children}</thead>
        ),
        tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
        tr: ({ children }: { children?: React.ReactNode }) => (
          <tr style={{ borderBottom: "1px solid var(--separator-color)" }}>{children}</tr>
        ),
        th: ({ children }: { children?: React.ReactNode }) => (
          <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{children}</th>
        ),
        td: ({ children }: { children?: React.ReactNode }) => (
          <td style={{ padding: "6px 12px", color: "var(--text-primary)", lineHeight: 1.55 }}>{children}</td>
        ),
      };
    },
    [],
  );

  const staticComponents = useMemo(() => makeComponents(false), [makeComponents]);
  const streamingComponents = useMemo(() => makeComponents(true), [makeComponents]);

  // Thinking state — shimmer text
  if (isThinking) {
    return (
      <div className="mb-2" style={{ maxWidth: "100%", paddingLeft: 2 }}>
        <span className="ai-shimmer-text" style={{ fontSize: 14 }}>
          Thinking...
        </span>
      </div>
    );
  }

  renderCounter.current = 0;

  const streamCtxValue = isStreaming
    ? { revealed: revealedWords.current, counter: renderCounter }
    : null;

  return (
    <div className="mb-2" style={{ maxWidth: "100%" }}>
      <div style={{ paddingLeft: 2, userSelect: "text" }}>
        {isStreaming ? (
          <StreamCtx.Provider value={streamCtxValue}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={streamingComponents}>
              {content}
            </ReactMarkdown>
          </StreamCtx.Provider>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={staticComponents}>
            {content}
          </ReactMarkdown>
        )}
      </div>

    </div>
  );
}
