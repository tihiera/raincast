import { Component, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <>
          {this.props.children}
          <div style={{
            position: "fixed",
            bottom: 16,
            left: 16,
            zIndex: 9999,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 14,
            background: "rgba(30, 30, 30, 0.92)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            maxWidth: 340,
            animation: "offlineSlideUp 0.35s ease-out",
          }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: "rgba(240, 160, 40, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <AlertTriangle size={16} strokeWidth={2} color="#f0a028" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>
                Something went wrong
              </div>
              <div style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.45)",
                marginTop: 2,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 60,
                overflow: "hidden",
              }}>
                {this.state.error.message}
              </div>
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                background: "none",
                border: "none",
                padding: 2,
                cursor: "pointer",
                color: "rgba(255,255,255,0.4)",
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </>
      );
    }
    return this.props.children;
  }
}
