import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import { claimAccount } from "../api.ts";
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
      if (user) await claimAccount();
      await Promise.all([useStore.getState().loadTrips(), useInsights.getState().initWatches(), useStore.getState().refreshQuota()]);
    })();
  }, [isLoaded, userId]);
  return null;
}

/** Header control: "Sign in" when signed out, the account menu when signed in. */
export function AccountButton() {
  if (!ACCOUNTS) return null;
  return (
    <div className="account">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="sign-in">Sign in</button>
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
  if (!ACCOUNTS) return null;
  return (
    <Show when="signed-out">
      <SignInButton mode="modal">
        <button className="link">Sign in for more live searches</button>
      </SignInButton>
    </Show>
  );
}
