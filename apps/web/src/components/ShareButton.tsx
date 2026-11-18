import { useState } from "react";
import type { TripPlan } from "@farescope/shared";
import { createShareLink } from "../share.ts";

export function ShareButton({ trips }: { trips: TripPlan[] }) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("");
  return <div className="share-controls"><button className="secondary" onClick={async () => {
    setStatus("Creating link…");
    try {
      const url = await createShareLink(trips);
      setLink(url);
      try { await navigator.clipboard.writeText(url); setStatus("Link copied."); }
      catch { setStatus("Select and copy the link below."); }
    } catch { setStatus("Could not create this link. Try sharing fewer trips or shortening the notes."); }
  }}>Share {trips.length > 1 ? "comparison" : "trip"}</button>
    {link && <><label className="field">Read-only link<input readOnly value={link} onFocus={event => event.target.select()} /></label>
      <p className="muted small">Anyone with this link can view this snapshot, including notes and prices. Later edits require a new link.</p>
      {["localhost", "127.0.0.1"].includes(window.location.hostname) && <p className="muted small">This local preview link only works on this computer. Share from the published website to invite someone else.</p>}</>}
    {status && <span role="status" className="small">{status}</span>}
  </div>;
}
