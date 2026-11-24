import { useEffect, useState } from "react";
import { track } from "../analytics.ts";

/** Chrome/Edge/Android's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * "Install app" link, shown only when the browser can install Tripica: the native prompt on
 * Chrome, Edge and Android, or a short "Add to Home Screen" tip on iPhone and iPad (Safari has no
 * prompt). Hidden once installed.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [tip, setTip] = useState(false);
  const [installed, setInstalled] = useState(standalone);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (installed || (!prompt && !isIOS())) return null;
  return <>
    {" · "}
    <button className="link install-app" onClick={async () => {
      track("install_click", prompt ? "prompt" : "ios-tip");
      if (!prompt) { setTip(!tip); return; }
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
      setPrompt(null);
    }}>Install app</button>
    {tip && <span className="install-tip" role="status"> Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span>}
  </>;
}
