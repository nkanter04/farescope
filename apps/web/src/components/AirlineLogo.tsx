import { useState } from "react";
import { fareCarriers, type Carrier, type Fare } from "@farescope/shared";

/** An airline's logo, or a brand-colored code badge when no logo is available or it fails to load. */
export function AirlineLogo({ carrier, size = 24, label = false }: { carrier: Carrier; size?: number; label?: boolean }) {
  const [failed, setFailed] = useState(false);
  const text = carrier.code.length <= 3 ? carrier.code : carrier.name.slice(0, 2).toUpperCase();
  return (
    <span className="airline-logo" style={{ width: size, height: size }} title={carrier.name}>
      {carrier.logo && !failed ? (
        <img src={carrier.logo} alt={label ? "" : carrier.name} width={size} height={size} loading="lazy" decoding="async"
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="airline-badge" style={{ background: carrier.color, fontSize: Math.round(size * 0.38) }} aria-hidden={label}>
          {text}
        </span>
      )}
    </span>
  );
}

/** Logos plus names for every airline on a fare, e.g. "[logo] American + [logo] Japan Airlines". */
export function FareAirlines({ fare, size = 22 }: { fare: Pick<Fare, "airlines" | "outbound">; size?: number }) {
  const carriers = fareCarriers(fare);
  return (
    <span className="fare-airlines">
      <span className="logo-stack">{carriers.map((c) => <AirlineLogo key={c.code} carrier={c} size={size} label />)}</span>
      <span className="airline-names">{carriers.map((c) => c.name).join(" + ")}</span>
    </span>
  );
}
