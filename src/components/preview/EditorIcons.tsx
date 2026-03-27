/**
 * Editor icons — uses real logos from assets/editors/ where available,
 * falls back to inline SVGs for the rest.
 */

// ── Real logos (imported as URLs by Vite) ──
import cursorLogo from "../../assets/editors/cursor.png";
import vscodeLogo from "../../assets/editors/vscode.png";
import zedLogo from "../../assets/editors/zed.png";
import neovimLogo from "../../assets/editors/neovim.png";
import intellijLogo from "../../assets/editors/intellij.png";
import xcodeLogo from "../../assets/editors/xcode.jpg";
import windsurfLogo from "../../assets/editors/windsurf.png";

// ── Image-based icon ──

function Img({ src, size = 16, alt }: { src: string; size?: number; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ display: "block", borderRadius: size > 20 ? 4 : 3, objectFit: "cover" }}
      draggable={false}
    />
  );
}

// ── SVG helper for fallback icons ──

const S = { display: "block" } as const;

function SvgIcon({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={S}>
      {children}
    </svg>
  );
}

// ── SVG icons ──

function FileExplorer({ size }: { size?: number }) {
  return (
    <SvgIcon size={size}>
      <path d="M2 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" fill="#5BA4CF" />
      <path d="M2 10h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8z" fill="#70B8E0" />
    </SvgIcon>
  );
}

function GenericEditor({ size }: { size?: number }) {
  return (
    <SvgIcon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8h10M7 12h7M7 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Unified map ──

type IconComponent = React.FC<{ size?: number }>;

const IMG_EDITORS: Record<string, { src: string; alt: string }> = {
  cursor: { src: cursorLogo, alt: "Cursor" },
  vscode: { src: vscodeLogo, alt: "VS Code" },
  zed: { src: zedLogo, alt: "Zed" },
  neovim: { src: neovimLogo, alt: "Neovim" },
  idea: { src: intellijLogo, alt: "IntelliJ IDEA" },
  xcode: { src: xcodeLogo, alt: "Xcode" },
  windsurf: { src: windsurfLogo, alt: "Windsurf" },
};

const SVG_EDITORS: Record<string, IconComponent> = {
  file_explorer: FileExplorer,
};

export function EditorIcon({ editorId, size = 16 }: { editorId: string; size?: number }) {
  const img = IMG_EDITORS[editorId];
  if (img) return <Img src={img.src} size={size} alt={img.alt} />;

  const Svg = SVG_EDITORS[editorId] ?? GenericEditor;
  return <Svg size={size} />;
}

export default { ...IMG_EDITORS, ...SVG_EDITORS };
