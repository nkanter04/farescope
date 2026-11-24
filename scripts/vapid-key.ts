/**
 * Prints a new VAPID key pair for price-drop alerts (Web Push). Put the private JWK in
 * apps/api/.env as VAPID_PRIVATE_JWK and in Cloudflare with `npx wrangler secret put VAPID_PRIVATE_JWK`.
 * Changing the key later means every device has to turn alerts on again.
 *
 *   npx tsx scripts/vapid-key.ts
 */
const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y }));
