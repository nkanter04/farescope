import { ACCOUNTS } from "./auth.ts";

/**
 * Clerk is only downloaded when accounts are configured: main.tsx loads ./components/Account.tsx
 * before the first render, and these slots render its pieces (or nothing without accounts).
 */
let mod: typeof import("./components/Account.tsx") | null = null;

export async function loadAccounts() {
  if (ACCOUNTS && !mod) mod = await import("./components/Account.tsx");
  return mod;
}

export function AccountButtonSlot() {
  const C = mod?.AccountButton;
  return C ? <C /> : null;
}

/** "Get more with Tripica Pro" next to an account's out-of-searches notice. */
export function ProPromptSlot() {
  const C = mod?.ProPrompt;
  return C ? <C /> : null;
}

/** Confirmation after returning from Stripe Checkout. */
export function ProReturnSlot() {
  const C = mod?.ProReturn;
  return C ? <C /> : null;
}

export function SignUpNudgeSlot({ place }: { place: "search" | "save" | "trips" }) {
  const C = mod?.SignUpNudge;
  return C ? <C place={place} /> : null;
}

export function AlertsSlot({ place }: { place: string }) {
  const C = mod?.AlertsControl;
  return C ? <C place={place} /> : null;
}

export function SignInPromptSlot() {
  const C = mod?.SignInPrompt;
  return C ? <C /> : null;
}
