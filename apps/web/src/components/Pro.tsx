import { useEffect, useRef, useState } from "react";
import { fetchBilling, openPortal, startCheckout, syncCheckout, type BillingInfo } from "../api.ts";
import { PRO } from "../pro.ts";
import { useStore } from "../store.ts";

/**
 * Tripica Pro UI (loaded with the account chunk, signed-in users only): the header button or
 * badge, the plan picker, and the return from Stripe Checkout. Shows nothing when billing is off.
 */
export function ProControls() {
  const quota = useStore((s) => s.quota);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!quota?.billing) return null;
  if (quota.pro) {
    return (
      <button className="pro-badge" title="Manage your Tripica Pro subscription" disabled={busy} onClick={async () => {
        setBusy(true);
        try { window.location.assign(await openPortal()); } catch (e) { alert((e as Error).message); setBusy(false); }
      }}>Pro</button>
    );
  }
  return (
    <>
      <button className="go-pro" onClick={() => setOpen(true)}>Go Pro</button>
      {open && <ProDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** Offered next to "you've used this month's searches" for signed-in free users. */
export function ProPrompt() {
  const quota = useStore((s) => s.quota);
  const [open, setOpen] = useState(false);
  if (!quota?.billing || quota.pro) return null;
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>Get more with Tripica Pro</button>
      {open && <ProDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ProDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [info, setInfo] = useState<BillingInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    void fetchBilling().then(setInfo).catch(() => setInfo({ enabled: true }));
  }, []);
  const trial = info?.canTrial !== false;
  const chosen = PRO[plan];
  return (
    <dialog ref={ref} className="pro-dialog" aria-labelledby="pro-title" onClose={onClose} onCancel={onClose}>
      <h2 id="pro-title">Tripica Pro</h2>
      <p className="muted">More live price searches for planning your trips.</p>
      <ul className="pro-perks">
        <li><strong>{PRO.credits} live credits a month</strong> (about {Math.round(PRO.credits / 5)} searches), instead of 50</li>
        <li>Price watches and trips on all your devices</li>
        <li>Cached prices stay free, as always</li>
      </ul>
      <div className="seg pro-plans" role="radiogroup" aria-label="Billing period">
        {(["monthly", "yearly"] as const).map((p) => (
          <button key={p} role="radio" aria-checked={plan === p} className={plan === p ? "on" : ""} onClick={() => setPlan(p)}>
            {PRO[p].price}/{PRO[p].per}{p === "yearly" && <small> {PRO.yearly.note}</small>}
          </button>
        ))}
      </div>
      <button className="primary pro-start" disabled={busy || !info} onClick={async () => {
        setBusy(true);
        setError("");
        try { window.location.assign(await startCheckout(plan)); } catch (e) { setError((e as Error).message); setBusy(false); }
      }}>{busy ? "Opening checkout…" : trial ? `Start ${PRO.trialDays}-day free trial` : `Subscribe for ${chosen.price}/${chosen.per}`}</button>
      <p className="small muted pro-terms">
        {trial
          ? `Card required. After ${PRO.trialDays} days you're charged ${chosen.price} per ${chosen.per} until you cancel. Cancel anytime before then and you won't be charged.`
          : `Renews at ${chosen.price} per ${chosen.per} until you cancel.`}{" "}
        Payments are handled by Stripe. See the <a href="../terms/" target="_blank" rel="noreferrer">terms</a>.
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="link pro-close" onClick={() => ref.current?.close()}>Not now</button>
    </dialog>
  );
}

/** Back from Stripe Checkout (?pro=welcome&session_id=… or ?pro=cancelled): confirm and say so. */
export function ProReturn() {
  const [message, setMessage] = useState<{ level: "info" | "warn"; text: string }>();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const state = q.get("pro");
    if (!state) return;
    const clean = () => window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (state === "cancelled") {
      setMessage({ level: "info", text: "Checkout cancelled. You haven't been charged." });
      clean();
      return;
    }
    const sessionId = q.get("session_id") ?? "";
    setMessage({ level: "info", text: "Confirming your Tripica Pro subscription…" });
    void (async () => {
      // The account may still be loading right after the redirect: retry a few times.
      for (let i = 0; i < 5; i++) {
        try {
          const r = await syncCheckout(sessionId);
          if (r.pro) {
            setMessage({ level: "info", text: "Welcome to Tripica Pro! Your extra live searches are ready." });
            await useStore.getState().refreshQuota();
            clean();
            return;
          }
        } catch { /* signed-in session not ready yet */ }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setMessage({ level: "warn", text: "We couldn't confirm the subscription yet. It will show up shortly; refresh in a minute." });
      clean();
    })();
  }, []);
  if (!message) return null;
  return (
    <p className={`notice ${message.level} pro-return`} role="status">
      {message.text} <button className="link" onClick={() => setMessage(undefined)}>Dismiss</button>
    </p>
  );
}
