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

export function SignInPromptSlot() {
  const C = mod?.SignInPrompt;
  return C ? <C /> : null;
}
