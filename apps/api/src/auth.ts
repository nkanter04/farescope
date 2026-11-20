import { verifyToken } from "@clerk/backend";

/**
 * Sign-in check for Clerk session tokens (the browser sends `Authorization: Bearer <token>`).
 * Returns the Clerk user id, or undefined for an invalid or expired token. Works on Node and
 * Cloudflare Workers. With a secret key Clerk's public keys are fetched once and cached; with the
 * PEM `jwtKey` verification needs no network at all.
 */
export interface ClerkAuthSettings {
  secretKey?: string;
  jwtKey?: string;
  /** Allowed site origins (e.g. https://tripica.farescope.workers.dev); protects against token reuse elsewhere. */
  authorizedParties?: string[];
}

export function clerkVerifier(s: ClerkAuthSettings): ((token: string) => Promise<string | undefined>) | undefined {
  if (!s.secretKey && !s.jwtKey) return undefined;
  return async (token) => {
    try {
      const payload = await verifyToken(token, {
        secretKey: s.secretKey || undefined,
        jwtKey: s.jwtKey || undefined,
        authorizedParties: s.authorizedParties?.length ? s.authorizedParties : undefined,
      });
      return typeof payload.sub === "string" && /^[A-Za-z0-9_]{3,80}$/.test(payload.sub) ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  };
}
