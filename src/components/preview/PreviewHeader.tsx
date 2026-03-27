import { Monitor, CodeXml, Rocket, ExternalLink, Loader2 } from "lucide-react";

export type ShipState = "idle" | "shipping" | "fixing" | "shipped" | "error";

interface Props {
  activeTab: "ui" | "code";
  onTabChange: (tab: "ui" | "code") => void;
  canShip: boolean;
  shipState: ShipState;
  onShip: () => void;
  onOpenApp: () => void;
}

export default function PreviewHeader({
  activeTab, onTabChange, canShip, shipState, onShip, onOpenApp,
}: Props) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between">
      <h2 className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {activeTab === "ui" ? "App Preview" : "Console"}
      </h2>

      <div className="flex items-center gap-2">
        {/* Ship / Open buttons */}
        {canShip && (
          <div className="flex items-center gap-1.5">
            {/* Open — stays visible after successful ship */}
            {shipState === "shipped" && (
              <button
                onClick={onOpenApp}
                title="Launch your app"
                className="flex items-center gap-1.5 rounded-lg"
                style={{
                  padding: "4px 10px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  background: "rgba(42, 170, 136, 0.12)",
                  color: "#2a8",
                  transition: "background 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(42, 170, 136, 0.2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(42, 170, 136, 0.12)"; }}
              >
                <ExternalLink size={13} strokeWidth={1.8} />
                <span>Open</span>
              </button>
            )}

            {/* Ship button — matches send button color */}
            <button
              onClick={onShip}
              disabled={shipState === "shipping" || shipState === "fixing"}
              title={
                shipState === "shipping" ? "Shipping your app..." :
                shipState === "fixing" ? "Fixing build errors..." :
                shipState === "shipped" ? "Ship again" :
                shipState === "error" ? "Retry shipping" :
                "Ship your app"
              }
              className="flex items-center gap-1.5 rounded-lg"
              style={{
                padding: "4px 10px",
                border: "none",
                cursor: (shipState === "shipping" || shipState === "fixing") ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 500,
                background: (shipState === "shipping" || shipState === "fixing")
                  ? "var(--slider-thumb)"
                  : shipState === "shipped"
                  ? "rgba(42, 170, 136, 0.12)"
                  : shipState === "error"
                  ? "rgba(220, 68, 68, 0.1)"
                  : "var(--slider-thumb)",
                color: (shipState === "shipping" || shipState === "fixing")
                  ? "#fff"
                  : shipState === "shipped"
                  ? "#2a8"
                  : shipState === "error"
                  ? "#d44"
                  : "#fff",
                opacity: (shipState === "shipping" || shipState === "fixing") ? 0.85 : 1,
                transition: "background 150ms ease, color 150ms ease, opacity 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (shipState === "idle") {
                  e.currentTarget.style.opacity = "0.85";
                }
              }}
              onMouseLeave={(e) => {
                if (shipState === "idle") {
                  e.currentTarget.style.opacity = "1";
                }
              }}
            >
              {(shipState === "shipping" || shipState === "fixing") ? (
                <Loader2 size={13} strokeWidth={1.8} className="animate-spin" />
              ) : (
                <Rocket size={13} strokeWidth={1.8} />
              )}
              <span>
                {shipState === "shipping" ? "Shipping..." :
                 shipState === "fixing" ? "Fixing..." :
                 shipState === "shipped" ? "Ship" :
                 shipState === "error" ? "Retry" :
                 "Ship"}
              </span>
            </button>
          </div>
        )}

        {/* UI / Code icon toggle */}
        <div className="flex rounded-lg overflow-hidden"
          style={{
            background: "var(--btn-muted-bg)",
            border: "1px solid var(--separator-color)",
          }}
        >
          <button
            onClick={() => onTabChange("ui")}
            title="UI Preview"
            style={{
              padding: "4px 8px",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: activeTab === "ui" ? "var(--input-bg)" : "transparent",
              color: activeTab === "ui" ? "var(--text-primary)" : "var(--text-tertiary)",
              borderRadius: activeTab === "ui" ? 6 : 0,
              transition: "all 150ms ease",
            }}
          >
            <Monitor size={14} strokeWidth={1.8} />
          </button>
          <button
            onClick={() => onTabChange("code")}
            title="Console Output"
            style={{
              padding: "4px 8px",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: activeTab === "code" ? "var(--input-bg)" : "transparent",
              color: activeTab === "code" ? "var(--text-primary)" : "var(--text-tertiary)",
              borderRadius: activeTab === "code" ? 6 : 0,
              transition: "all 150ms ease",
            }}
          >
            <CodeXml size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
