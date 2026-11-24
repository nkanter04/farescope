import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import { claimAccount, submitSurvey } from "../api.ts";
import { track } from "../analytics.ts";
import { ACCOUNTS, CLERK_KEY, setTokenGetter } from "../auth.ts";
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
      <SignInButton mode="modal">
        <button className="link" onClick={() => track("signin_open", "limit")}>Sign in for more live searches</button>
      </SignInButton>
    </Show>
  );
}
