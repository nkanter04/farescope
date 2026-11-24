import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton, useAuth, useClerk } from "@clerk/react";
import { claimAccount, submitSurvey } from "../api.ts";
import { track } from "../analytics.ts";
import { ACCOUNTS, CLERK_KEY, setTokenGetter } from "../auth.ts";
import { ACCOUNT_BENEFITS } from "../accountBenefits.ts";
import { alertConfig, alertState, disableAlerts, enableAlerts, type AlertState } from "../push.ts";
import { useInsights } from "../insights.ts";
import { useStore } from "../store.ts";
import { ProControls, ProPrompt, ProReturn } from "./Pro.tsx";

export { ProPrompt, ProReturn };

/**
 * Accounts (Clerk). Everything here renders nothing unless the build has a publishable key, so
 * the demo and builds without accounts behave exactly as before.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  if (!ACCOUNTS) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl={window.location.pathname}>
      <AccountBridge />
      {children}
    </ClerkProvider>
  );
}

/** Hands the session token to the API client, and on sign-in moves this browser's data to the account. */
function AccountBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const lastUser = useRef<string | null | undefined>(undefined);
  const [survey, setSurvey] = useState(false);
  const clerk = useClerk();
  useEffect(() => {
    if (!isLoaded || isSignedIn || !new URLSearchParams(window.location.search).has("signup")) return;
    track("signin_open", "homepage");
    clerk.openSignUp({});
    const url = new URL(window.location.href);
    url.searchParams.delete("signup");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [isLoaded, isSignedIn, clerk]);
  useEffect(() => {
    setTokenGetter(isSignedIn ? () => getToken() : undefined);
  }, [isSignedIn, getToken]);
  useEffect(() => {
    if (!isLoaded) return;
    const user = userId ?? null;
    if (lastUser.current === user) return;
    const first = lastUser.current === undefined;
    lastUser.current = user;
    if (first && !user) return; // signed out on load: nothing changed
    void (async () => {
      if (user) {
        const { newAccount } = await claimAccount();
        track("signed_in", newAccount ? "new" : "returning");
        if (newAccount) setSurvey(true);
      }
      await Promise.all([useStore.getState().loadTrips(), useInsights.getState().initWatches(), useStore.getState().refreshQuota()]);
    })();
  }, [isLoaded, userId]);
  return survey ? <SignupSurvey close={() => setSurvey(false)} /> : null;
}

const HEARD: [string, string][] = [["google", "Google search"], ["reddit", "Reddit"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["friend", "A friend"], ["other", "Somewhere else"]];
const AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

/** Two optional questions for a brand-new account: how they found Tripica, and an age range. */
function SignupSurvey({ close }: { close(): void }) {
  const [heard, setHeard] = useState<string>();
  const [age, setAge] = useState<string>();
  const [sending, setSending] = useState(false);
  const chips = (options: [string, string][], value: string | undefined, set: (v: string | undefined) => void, label: string) => (
    <div className="survey-chips" role="group" aria-label={label}>
      {options.map(([v, text]) => <button type="button" key={v} className={value === v ? "on" : ""} aria-pressed={value === v} onClick={() => set(value === v ? undefined : v)}>{text}</button>)}
    </div>
  );
  return <section className="signup-survey card" role="dialog" aria-labelledby="survey-title">
    <h2 id="survey-title">Welcome to Tripica!</h2>
    <p className="muted small">Two optional questions help us improve. You can skip them.</p>
    <h3>How did you hear about Tripica?</h3>
    {chips(HEARD, heard, setHeard, "How did you hear about Tripica?")}
    <h3>Your age range</h3>
    {chips([...AGES.map((a): [string, string] => [a, a]), ["skip", "Prefer not to say"]], age, setAge, "Your age range")}
    <div className="survey-actions">
      <button className="primary" disabled={(!heard && !age) || sending} onClick={async () => {
        setSending(true);
        await submitSurvey({ heard, age });
        close();
      }}>{sending ? "Sending…" : "Send"}</button>
      <button className="link" onClick={close}>Skip</button>
    </div>
  </section>;
}

/** Header control: "Sign in" when signed out, the account menu when signed in. */
export function AccountButton() {
  if (!ACCOUNTS) return null;
  return (
    <div className="account">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="sign-in" onClick={() => track("signin_open", "header")}>Sign in</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <ProControls />
        <UserButton />
      </Show>
    </div>
  );
}

/** Offered next to "out of free searches" notices. */
export function SignInPrompt() {
  useEffect(() => { if (ACCOUNTS) track("signin_prompt", undefined, "signin_prompt"); }, []);
  if (!ACCOUNTS) return null;
  return (
    <Show when="signed-out">
      <AccountPitch place="limit" title="Keep searching with a free account" />
    </Show>
  );
}

/** "Create a free account" with what it gives (#3). Free, no card. */
function AccountPitch({ place, title, compact }: { place: string; title: string; compact?: boolean }) {
  return <div className={`account-pitch${compact ? " compact" : ""}`}>
    <strong>{title}</strong>
    {!compact && <ul>{ACCOUNT_BENEFITS.map((b) => <li key={b}>{b}</li>)}</ul>}
    <div className="account-pitch-actions">
      <SignUpButton mode="modal">
        <button className="primary small-btn" onClick={() => track("signin_open", place)}>Create a free account</button>
      </SignUpButton>
      <SignInButton mode="modal">
        <button className="link" onClick={() => track("signin_open", `${place}-signin`)}>I have one</button>
      </SignInButton>
      <span className="muted small">Free, no card.</span>
    </div>
  </div>;
}

const NUDGES: Record<string, { title: string; dismissible?: boolean; compact?: boolean }> = {
  search: { title: "Found something good? Save it, see it on every device, and get price-drop alerts with a free account.", dismissible: true },
  save: { title: "Saved on this browser only. A free account keeps it on all your devices.", compact: true },
  trips: { title: "These trips are saved on this browser only. A free account keeps them on all your devices and can alert you when watched prices drop.", dismissible: true },
};

/** Sign-up nudge at a "win" moment (#2): after a good search, after saving, on My trips. */
export function SignUpNudge({ place }: { place: keyof typeof NUDGES }) {
  const n = NUDGES[place];
  const key = `tripica.nudge.${place}`;
  const [hidden, setHidden] = useState(() => { try { return !!localStorage.getItem(key); } catch { return false; } });
  useEffect(() => { if (ACCOUNTS && !hidden) track("signup_nudge", place, `nudge-${place}`); }, [hidden, place]);
  if (!ACCOUNTS || !n || hidden) return null;
  return (
    <Show when="signed-out">
      <div className={`signup-nudge${n.compact ? " compact" : ""}`} role="note">
        <AccountPitch place={place} title={n.title} compact />
        {n.dismissible && <button className="link nudge-close" aria-label="Dismiss" onClick={() => {
          try { localStorage.setItem(key, "1"); } catch { /* fine */ }
          setHidden(true);
        }}>✕</button>}
      </div>
    </Show>
  );
}

/** Price-drop alerts for this device (#1): the switch when signed in, a sign-up nudge when not. */
export function AlertsControl({ place }: { place: string }) {
  const [state, setState] = useState<AlertState | "loading">("loading");
  const [watches, setWatches] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    void alertState().then((s) => { if (live) setState(s); });
    void alertConfig().then((c) => { if (live && c) setWatches(c.watches); });
    return () => { live = false; };
  }, [isSignedIn]);
  if (!ACCOUNTS) return null;
  return <>
    <Show when="signed-out">
      <div className="alerts-control">
        <span>Get a weekly alert when watched prices drop, even with Tripica closed.</span>
        <SignUpButton mode="modal">
          <button className="link" onClick={() => track("signin_open", `alerts-${place}`)}>Create a free account</button>
        </SignUpButton>
      </div>
    </Show>
    <Show when="signed-in">
      {state !== "loading" && state !== "unavailable" && <div className="alerts-control">
        {state === "on" && <><span>🔔 Price-drop alerts are on for this device (weekly, your first {watches} watched flights).</span>
          <button className="link" disabled={busy} onClick={async () => { setBusy(true); await disableAlerts(); setState("off"); setBusy(false); }}>Turn off</button></>}
        {state === "off" && <><span>Get a weekly notification when your first {watches} watched flights drop in price.</span>
          <button className="secondary small-btn" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            const r = await enableAlerts();
            if (r.ok) { setState("on"); track("alerts_on", place); } else setError(r.error);
            setBusy(false);
          }}>{busy ? "Turning on…" : "Turn on alerts"}</button></>}
        {state === "needs-install" && <span>On iPhone, add Tripica to your Home Screen (Share → Add to Home Screen) and open it from there to get price-drop alerts.</span>}
        {state === "blocked" && <span>Notifications are blocked for Tripica in this browser's settings. Allow them to get price-drop alerts.</span>}
        {state === "unsupported" && <span>This browser can't show price-drop alerts. Try Chrome, Edge, Firefox or Safari.</span>}
        {error && <span className="small bad-text">{error}</span>}
      </div>}
    </Show>
  </>;
}
