import { THEME_NAMES, applyTheme, useThemeName } from "../theme.ts";

/** Floating theme switcher for comparing drafts. Shown in dev, or with ?themes in the URL. */
export function ThemePicker() {
  const name = useThemeName();
  const show = import.meta.env.DEV || new URLSearchParams(location.search).has("themes");
  if (!show || THEME_NAMES.length < 2) return null;
  return (
    <label
      style={{
        position: "fixed", right: 12, bottom: 12, zIndex: 1000, display: "flex", gap: 6, alignItems: "center",
        padding: "6px 10px", borderRadius: 999, background: "rgba(0,0,0,0.75)", color: "#fff",
        font: "12px system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    >
      Theme
      <select
        value={name}
        onChange={(e) => void applyTheme(e.target.value)}
        style={{ background: "#111", color: "#fff", border: "1px solid #444", borderRadius: 6, padding: "2px 4px", width: "auto" }}
      >
        {THEME_NAMES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </label>
  );
}
