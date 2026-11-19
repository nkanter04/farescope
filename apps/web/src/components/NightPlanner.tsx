import { useState } from "react";
import { daysBetween, suggestPlaces, type Fare, type LodgingStop } from "@farescope/shared";
import { cityOf, shortDate } from "../format.ts";
import { initialNightRows, previewNightPlan, type NightRow } from "../nightPlan.ts";

export function NightPlanner({ fare, stops, apply, cancel }: {
  fare: Fare; stops: LodgingStop[]; apply(stops: LodgingStop[]): void; cancel(): void;
}) {
  const arrival = fare.outbound.at(-1)?.arrive.slice(0, 10) || fare.departDate;
  const [rows, setRows] = useState(() => stops.length ? initialNightRows(stops) : [
    { id: crypto.randomUUID(), place: cityOf(fare.destination), nights: "1" }
  ]);
  const [start, setStart] = useState(() => [...stops].sort((a,b) => a.checkIn.localeCompare(b.checkIn))[0]?.checkIn || arrival);
  const plan = previewNightPlan(start, rows, stops);
  const end = plan.at(-1)?.checkOut;
  const remaining = fare.returnDate && end ? daysBetween(end, fare.returnDate) : undefined;
  const cleared = stops.filter(stop => (stop.stay || stop.ownCost !== undefined) && !plan.includes(stop)).length;
  const valid = start >= arrival && plan.length > 0 && plan.every(stop => stop.place.length >= 2 && stop.checkOut)
    && (remaining === undefined || remaining >= 0);
  const edit = (id: string, patch: Partial<NightRow>) => setRows(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return <section className="card lodging-editor" aria-label="Plan consecutive stays">
    <h3>Plan consecutive stays</h3>
    <p className="muted small">List your overnight stops in travel order. Each checkout becomes the next check-in.</p>
    <label className="field">First check-in<input type="date" min={arrival} max={fare.returnDate} value={start} onChange={e => setStart(e.target.value)} /></label>
    {rows.map((row, i) => <fieldset key={row.id} className="night-stop">
      <legend>Stop {i + 1}</legend>
      <div className="row"><label className="field">Place<input maxLength={160} list={`night-${row.id}`} placeholder="City, neighborhood or address" value={row.place} onChange={e => edit(row.id, { place: e.target.value })} /></label>
        <datalist id={`night-${row.id}`}>{suggestPlaces(row.place).map(p => <option key={p.token} value={p.label} />)}</datalist>
        <label className="field">Nights<input type="number" min={1} max={365} value={row.nights} onChange={e => edit(row.id, { nights: e.target.value })} /></label></div>
      <div className="editor-actions"><span className="small">{plan[i].checkOut && `${shortDate(plan[i].checkIn)} – ${shortDate(plan[i].checkOut)}`}</span>
        <button className="link" disabled={rows.length === 1} onClick={() => setRows(rows.filter(r => r.id !== row.id))}>Remove stop {i + 1}</button></div>
    </fieldset>)}
    <button className="secondary" disabled={rows.length >= 30} onClick={() => setRows([...rows, { id: crypto.randomUUID(), place: "", nights: "1" }])}>Add next stop</button>
    <p aria-live="polite" className="small">{start && start < arrival ? "First check-in is before your flight arrives." :
      remaining === undefined ? "" : remaining < 0 ? `Shorten the route by ${-remaining} night(s) to catch your return flight.` :
      remaining === 0 ? "Last checkout matches your return flight." : `${remaining} night(s) between last checkout and your return flight.`}</p>
    {cleared > 0 && <p className="notice warn">Applying this route will clear accommodation selections or costs for {cleared} changed or removed {cleared === 1 ? "stay" : "stays"}.</p>}
    <div className="editor-actions"><button className="primary" disabled={!valid} onClick={() => apply(plan)}>Apply route</button><button className="link" onClick={cancel}>Cancel</button></div>
  </section>;
}
