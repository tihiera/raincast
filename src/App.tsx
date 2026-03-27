import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";
import { ThemeProvider } from "./ThemeContext";
import { GenerationProvider } from "./lib/generation/GenerationContext";
import { PreviewProvider } from "./lib/preview/PreviewContext";
import { ProjectProvider } from "./lib/project/ProjectContext";
import { SketchProvider } from "./lib/sketch/SketchContext";
import ErrorBoundary from "./components/ErrorBoundary";
import TopTabsBar from "./components/TopTabsBar";
import SplitWorkspace from "./components/SplitWorkspace";
import PreviewPane from "./components/preview";
import ChatPane from "./components/chat";

function OfflineOverlay() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 16,
      left: 16,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 14px",
      borderRadius: 14,
      background: "rgba(30, 30, 30, 0.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      animation: "offlineSlideUp 0.35s ease-out",
    }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 10,
        background: "rgba(240, 80, 80, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <WifiOff size={16} strokeWidth={2} color="#f06060" />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>
          No internet connection
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>
          Connect to use AI features
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ProjectProvider>
        <GenerationProvider>
          <PreviewProvider>
          <SketchProvider>
            <ErrorBoundary>
            <div
              className="flex flex-col h-screen w-screen overflow-hidden"
              style={{
                background: "var(--app-bg)",
              }}
            >
              <TopTabsBar />
              <SplitWorkspace
                left={<ErrorBoundary><PreviewPane /></ErrorBoundary>}
                right={<ErrorBoundary><ChatPane /></ErrorBoundary>}
              />
            </div>
            <OfflineOverlay />
            </ErrorBoundary>
          </SketchProvider>
          </PreviewProvider>
        </GenerationProvider>
      </ProjectProvider>
    </ThemeProvider>
  );
}

export default App;
