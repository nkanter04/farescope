/**
 * Sign-in plumbing shared by the API client and the account UI. Clerk is only loaded when the
 * build has a publishable key (VITE_CLERK_PUBLISHABLE_KEY, public) and isn't the demo; otherwise
 * the app works exactly as before, without accounts.
 */
export const CLERK_KEY = (import.meta.env.MODE === "demo" ? "" : (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)) || "";
export const ACCOUNTS = CLERK_KEY.startsWith("pk_");

let getToken: (() => Promise<string | null>) | undefined;

/** Registered by the account bridge once Clerk has loaded. */
export function setTokenGetter(fn: (() => Promise<string | null>) | undefined) {
  getToken = fn;
}

/** `Authorization` header for a signed-in user, or nothing. */
export async function authHeader(): Promise<Record<string, string>> {
  const token = getToken ? await getToken().catch(() => null) : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}
