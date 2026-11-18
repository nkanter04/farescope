import type { Fare } from "./types.ts";

/**
 * Airline catalog: IATA code, display name, brand color (used for the fallback badge) and alliance.
 * Logos are the airlines' trademarks, shown only to identify the carrier. With live data the
 * provider supplies each segment's logo URL; otherwise we use the same public CDN Google Flights
 * uses, for codes in this catalog only (unknown codes there return a generic placeholder).
 */
export type Alliance = "star" | "oneworld" | "skyteam";

export interface AirlineInfo {
  code: string;
  name: string;
  color: string;
  alliance?: Alliance;
  aliases?: string[];
}

export const ALLIANCE_NAMES: Record<Alliance, string> = { star: "Star Alliance", oneworld: "oneworld", skyteam: "SkyTeam" };

export const AIRLINE_LOGO_BASE = "https://www.gstatic.com/flights/airline_logos/70px/";

const L = (code: string, name: string, color: string, alliance?: Alliance, aliases?: string[]): AirlineInfo => ({
  code, name, color, alliance, aliases,
});

export const AIRLINES: AirlineInfo[] = [
  // North America
  L("AA", "American", "#0078D2", "oneworld", ["american airlines"]),
  L("DL", "Delta", "#C8102E", "skyteam", ["delta air lines"]),
  L("UA", "United", "#005DAA", "star", ["united airlines"]),
  L("WN", "Southwest", "#304CB2", undefined, ["southwest airlines"]),
  L("AS", "Alaska", "#01426A", "oneworld", ["alaska airlines"]),
  L("B6", "JetBlue", "#0033A0", undefined, ["jetblue airways"]),
  L("F9", "Frontier", "#00704A", undefined, ["frontier airlines"]),
  L("NK", "Spirit", "#BFA200", undefined, ["spirit airlines"]),
  L("HA", "Hawaiian", "#4E2A84", undefined, ["hawaiian airlines"]),
  L("SY", "Sun Country", "#F28C28", undefined, ["sun country airlines"]),
  L("G4", "Allegiant", "#00477F", undefined, ["allegiant air"]),
  L("MX", "Breeze", "#0B2D71", undefined, ["breeze airways"]),
  L("AC", "Air Canada", "#D22630", "star"),
  L("WS", "WestJet", "#00A3AD"),
  L("PD", "Porter", "#002F5F", undefined, ["porter airlines"]),
  L("TS", "Air Transat", "#00ADEF"),
  // Latin America & Caribbean
  L("AM", "Aeromexico", "#0B2343", "skyteam", ["aeroméxico"]),
  L("CM", "Copa", "#00529B", "star", ["copa airlines"]),
  L("Y4", "Volaris", "#A12885"),
  L("LA", "LATAM", "#1B0088", undefined, ["latam airlines"]),
  L("AV", "Avianca", "#E41B13", "star"),
  L("AR", "Aerolineas Argentinas", "#0A3D7A", "skyteam", ["aerolíneas argentinas"]),
  L("G3", "GOL", "#FF5A00", undefined, ["gol linhas aereas"]),
  // Europe
  L("BA", "British Airways", "#075AAA", "oneworld"),
  L("LH", "Lufthansa", "#05164D", "star"),
  L("AF", "Air France", "#002157", "skyteam"),
  L("KL", "KLM", "#00A1DE", "skyteam", ["klm royal dutch airlines"]),
  L("IB", "Iberia", "#D7192D", "oneworld"),
  L("TK", "Turkish Airlines", "#C70A0C", "star"),
  L("TP", "TAP", "#00B2A9", "star", ["tap air portugal"]),
  L("FR", "Ryanair", "#073590"),
  L("U2", "easyJet", "#FF6600"),
  L("W6", "Wizz Air", "#C6007E"),
  L("LX", "Swiss", "#E2001A", "star", ["swiss international air lines"]),
  L("OS", "Austrian", "#E3001B", "star", ["austrian airlines"]),
  L("SK", "SAS", "#000F9F", "skyteam", ["scandinavian airlines"]),
  L("AY", "Finnair", "#0B1560", "oneworld"),
  L("EI", "Aer Lingus", "#006272"),
  L("VS", "Virgin Atlantic", "#DA0530", "skyteam"),
  L("FI", "Icelandair", "#003A7D"),
  L("AZ", "ITA Airways", "#003C71", "skyteam"),
  // Middle East & Africa
  L("EK", "Emirates", "#D71921"),
  L("QR", "Qatar Airways", "#5C0632", "oneworld"),
  L("EY", "Etihad", "#BD8B13", undefined, ["etihad airways"]),
  L("LY", "El Al", "#0A2C78", undefined, ["el al israel airlines"]),
  L("SV", "Saudia", "#006C35", "skyteam"),
  L("ET", "Ethiopian", "#078930", "star", ["ethiopian airlines"]),
  L("KQ", "Kenya Airways", "#B4161D", "skyteam"),
  L("AT", "Royal Air Maroc", "#C1272D", "oneworld"),
  L("MS", "EgyptAir", "#00265D", "star"),
  L("SA", "South African", "#00205B", "star", ["south african airways"]),
  // Asia & Oceania
  L("NH", "ANA", "#13448F", "star", ["all nippon airways"]),
  L("JL", "Japan Airlines", "#CC0000", "oneworld", ["jal"]),
  L("KE", "Korean Air", "#00256C", "skyteam"),
  L("OZ", "Asiana", "#8C1D40", "star", ["asiana airlines"]),
  L("SQ", "Singapore Airlines", "#F99F1C", "star"),
  L("CX", "Cathay Pacific", "#006564", "oneworld"),
  L("BR", "EVA Air", "#00764B", "star"),
  L("CI", "China Airlines", "#C4122F", "skyteam"),
  L("TG", "Thai Airways", "#4B2C82", "star", ["thai"]),
  L("MH", "Malaysia Airlines", "#00205B", "oneworld"),
  L("GA", "Garuda Indonesia", "#00718F", "skyteam"),
  L("PR", "Philippine Airlines", "#0038A8"),
  L("VN", "Vietnam Airlines", "#005B8C", "skyteam"),
  L("CA", "Air China", "#E30613", "star"),
  L("MU", "China Eastern", "#00305E", "skyteam"),
  L("CZ", "China Southern", "#0067B1"),
  L("AI", "Air India", "#C8102E", "star"),
  L("6E", "IndiGo", "#001B94"),
  L("ZG", "ZIPAIR", "#00A0A0"),
  L("MM", "Peach", "#D6006F"),
  L("JQ", "Jetstar", "#FF5115"),
  L("TR", "Scoot", "#FFD700"),
  L("AK", "AirAsia", "#E3000F"),
  L("5J", "Cebu Pacific", "#FFC20E"),
  L("QF", "Qantas", "#E40000", "oneworld"),
  L("NZ", "Air New Zealand", "#000000", "star"),
  L("VA", "Virgin Australia", "#E1163C"),
  L("FJ", "Fiji Airways", "#6B4C9A", "oneworld"),
];

export const AIRLINE_BY_CODE: Record<string, AirlineInfo> = Object.fromEntries(AIRLINES.map((a) => [a.code, a]));

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const BY_NAME = new Map<string, AirlineInfo>();
for (const a of AIRLINES) for (const n of [a.name, ...(a.aliases ?? [])]) BY_NAME.set(norm(n), a);

/** Look up an airline by IATA code or name. */
export function findAirline(codeOrName: string | undefined): AirlineInfo | undefined {
  if (!codeOrName) return undefined;
  return AIRLINE_BY_CODE[codeOrName.trim().toUpperCase()] ?? BY_NAME.get(norm(codeOrName));
}

/** IATA code from a flight number such as "AA 2423" or "NH7". */
export function codeFromFlightNumber(flightNumber: string | undefined): string | undefined {
  const m = flightNumber?.trim().toUpperCase().match(/^([A-Z0-9]{2})\s?\d{1,4}[A-Z]?$/);
  return m ? m[1] : undefined;
}

export interface Carrier {
  /** IATA code when known; otherwise the airline name. */
  code: string;
  name: string;
  logo?: string;
  color: string;
  alliance?: Alliance;
}

/** Stable fallback color for airlines we don't know. */
function colorFor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 38%)`;
}

export function carrierFrom(name: string, code?: string, logo?: string): Carrier {
  const info = findAirline(code) ?? findAirline(name);
  const resolvedCode = info?.code ?? code ?? name;
  return {
    code: resolvedCode,
    name: info?.name ?? name,
    logo: logo || (info ? `${AIRLINE_LOGO_BASE}${info.code}.png` : undefined),
    color: info?.color ?? colorFor(resolvedCode),
    alliance: info?.alliance,
  };
}

/** The airlines operating a fare's outbound segments (or its listed airlines), de-duplicated. */
export function fareCarriers(fare: Pick<Fare, "airlines" | "outbound">): Carrier[] {
  const out = new Map<string, Carrier>();
  for (const leg of fare.outbound ?? []) {
    if (!leg.airline && !leg.airlineCode) continue;
    const c = carrierFrom(leg.airline, leg.airlineCode ?? codeFromFlightNumber(leg.flightNumber), leg.airlineLogo);
    if (!out.has(c.code)) out.set(c.code, c);
  }
  if (!out.size) for (const name of fare.airlines ?? []) {
    const c = carrierFrom(name);
    if (!out.has(c.code)) out.set(c.code, c);
  }
  return [...out.values()];
}

/** True when every airline on the fare is in the allowed set (empty set = any airline). */
export function fareMatchesAirlines(fare: Pick<Fare, "airlines" | "outbound">, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  const set = new Set(allowed);
  const carriers = fareCarriers(fare);
  return carriers.length > 0 && carriers.every((c) => set.has(c.code));
}
