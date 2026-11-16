/**
 * Curated set of major airports for v1. Coordinates are approximate (~0.01 deg), good for the
 * globe and distance-based mock pricing. Later this can be generated from the public-domain
 * OurAirports dataset to cover every commercial airport.
 */
export type Region =
  | "North America"
  | "Central America & Caribbean"
  | "South America"
  | "Europe"
  | "Middle East"
  | "Africa"
  | "Asia"
  | "Oceania";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lng: number;
}

export const COUNTRIES: Record<string, { name: string; region: Region; aliases?: string[]; costIndex: number }> = {
  US: { name: "United States", region: "North America", aliases: ["usa", "america", "united states of america"], costIndex: 1.0 },
  CA: { name: "Canada", region: "North America", costIndex: 0.95 },
  MX: { name: "Mexico", region: "Central America & Caribbean", costIndex: 0.55 },
  CR: { name: "Costa Rica", region: "Central America & Caribbean", costIndex: 0.7 },
  PA: { name: "Panama", region: "Central America & Caribbean", costIndex: 0.65 },
  PR: { name: "Puerto Rico", region: "Central America & Caribbean", costIndex: 0.85 },
  DO: { name: "Dominican Republic", region: "Central America & Caribbean", costIndex: 0.7 },
  JM: { name: "Jamaica", region: "Central America & Caribbean", costIndex: 0.8 },
  BS: { name: "Bahamas", region: "Central America & Caribbean", costIndex: 1.1 },
  CO: { name: "Colombia", region: "South America", costIndex: 0.45 },
  PE: { name: "Peru", region: "South America", costIndex: 0.5 },
  BR: { name: "Brazil", region: "South America", costIndex: 0.55 },
  AR: { name: "Argentina", region: "South America", costIndex: 0.45 },
  CL: { name: "Chile", region: "South America", costIndex: 0.6 },
  GB: { name: "United Kingdom", region: "Europe", aliases: ["uk", "england", "britain", "great britain"], costIndex: 1.1 },
  FR: { name: "France", region: "Europe", costIndex: 1.0 },
  NL: { name: "Netherlands", region: "Europe", aliases: ["holland"], costIndex: 1.05 },
  DE: { name: "Germany", region: "Europe", costIndex: 0.9 },
  ES: { name: "Spain", region: "Europe", costIndex: 0.75 },
  IT: { name: "Italy", region: "Europe", costIndex: 0.85 },
  PT: { name: "Portugal", region: "Europe", costIndex: 0.7 },
  IE: { name: "Ireland", region: "Europe", costIndex: 1.05 },
  CH: { name: "Switzerland", region: "Europe", costIndex: 1.4 },
  AT: { name: "Austria", region: "Europe", costIndex: 0.9 },
  DK: { name: "Denmark", region: "Europe", costIndex: 1.15 },
  SE: { name: "Sweden", region: "Europe", costIndex: 1.0 },
  NO: { name: "Norway", region: "Europe", costIndex: 1.2 },
  FI: { name: "Finland", region: "Europe", costIndex: 1.0 },
  GR: { name: "Greece", region: "Europe", costIndex: 0.7 },
  TR: { name: "Turkey", region: "Europe", aliases: ["turkiye"], costIndex: 0.5 },
  CZ: { name: "Czechia", region: "Europe", aliases: ["czech republic"], costIndex: 0.65 },
  IS: { name: "Iceland", region: "Europe", costIndex: 1.3 },
  BE: { name: "Belgium", region: "Europe", costIndex: 0.95 },
  PL: { name: "Poland", region: "Europe", costIndex: 0.55 },
  HU: { name: "Hungary", region: "Europe", costIndex: 0.55 },
  AE: { name: "United Arab Emirates", region: "Middle East", aliases: ["uae"], costIndex: 1.0 },
  QA: { name: "Qatar", region: "Middle East", costIndex: 1.0 },
  IL: { name: "Israel", region: "Middle East", costIndex: 1.1 },
  EG: { name: "Egypt", region: "Africa", costIndex: 0.4 },
  ZA: { name: "South Africa", region: "Africa", costIndex: 0.5 },
  KE: { name: "Kenya", region: "Africa", costIndex: 0.5 },
  MA: { name: "Morocco", region: "Africa", costIndex: 0.45 },
  ET: { name: "Ethiopia", region: "Africa", costIndex: 0.4 },
  JP: { name: "Japan", region: "Asia", costIndex: 0.8 },
  KR: { name: "South Korea", region: "Asia", aliases: ["korea"], costIndex: 0.75 },
  CN: { name: "China", region: "Asia", costIndex: 0.6 },
  HK: { name: "Hong Kong", region: "Asia", costIndex: 1.0 },
  TW: { name: "Taiwan", region: "Asia", costIndex: 0.65 },
  SG: { name: "Singapore", region: "Asia", costIndex: 1.1 },
  TH: { name: "Thailand", region: "Asia", costIndex: 0.4 },
  MY: { name: "Malaysia", region: "Asia", costIndex: 0.4 },
  ID: { name: "Indonesia", region: "Asia", aliases: ["bali"], costIndex: 0.4 },
  PH: { name: "Philippines", region: "Asia", costIndex: 0.4 },
  VN: { name: "Vietnam", region: "Asia", costIndex: 0.35 },
  IN: { name: "India", region: "Asia", costIndex: 0.35 },
  LK: { name: "Sri Lanka", region: "Asia", costIndex: 0.35 },
  NP: { name: "Nepal", region: "Asia", costIndex: 0.3 },
  MV: { name: "Maldives", region: "Asia", costIndex: 1.6 },
  AU: { name: "Australia", region: "Oceania", costIndex: 0.95 },
  NZ: { name: "New Zealand", region: "Oceania", costIndex: 0.95 },
  FJ: { name: "Fiji", region: "Oceania", costIndex: 0.9 },
  PF: { name: "French Polynesia", region: "Oceania", aliases: ["tahiti"], costIndex: 1.5 },
};

const A = (iata: string, name: string, city: string, country: string, lat: number, lng: number): Airport => ({
  iata, name, city, country, lat, lng,
});

export const AIRPORTS: Airport[] = [
  // United States
  A("AUS", "Austin-Bergstrom", "Austin", "US", 30.197, -97.666),
  A("DFW", "Dallas/Fort Worth", "Dallas", "US", 32.897, -97.038),
  A("DAL", "Dallas Love Field", "Dallas", "US", 32.847, -96.852),
  A("IAH", "Houston Bush", "Houston", "US", 29.984, -95.341),
  A("HOU", "Houston Hobby", "Houston", "US", 29.646, -95.278),
  A("SAT", "San Antonio", "San Antonio", "US", 29.534, -98.469),
  A("LAX", "Los Angeles", "Los Angeles", "US", 33.942, -118.408),
  A("SFO", "San Francisco", "San Francisco", "US", 37.619, -122.375),
  A("SEA", "Seattle-Tacoma", "Seattle", "US", 47.450, -122.309),
  A("JFK", "New York JFK", "New York", "US", 40.641, -73.778),
  A("EWR", "Newark Liberty", "New York", "US", 40.690, -74.174),
  A("LGA", "New York LaGuardia", "New York", "US", 40.777, -73.872),
  A("ORD", "Chicago O'Hare", "Chicago", "US", 41.974, -87.907),
  A("ATL", "Atlanta Hartsfield-Jackson", "Atlanta", "US", 33.640, -84.427),
  A("DEN", "Denver", "Denver", "US", 39.856, -104.674),
  A("MIA", "Miami", "Miami", "US", 25.796, -80.287),
  A("BOS", "Boston Logan", "Boston", "US", 42.366, -71.010),
  A("LAS", "Las Vegas Harry Reid", "Las Vegas", "US", 36.084, -115.154),
  A("PHX", "Phoenix Sky Harbor", "Phoenix", "US", 33.437, -112.008),
  A("MSP", "Minneapolis-St Paul", "Minneapolis", "US", 44.885, -93.222),
  A("DTW", "Detroit Metro", "Detroit", "US", 42.212, -83.353),
  A("IAD", "Washington Dulles", "Washington", "US", 38.953, -77.456),
  A("DCA", "Washington Reagan", "Washington", "US", 38.852, -77.038),
  A("PHL", "Philadelphia", "Philadelphia", "US", 39.874, -75.243),
  A("CLT", "Charlotte Douglas", "Charlotte", "US", 35.214, -80.943),
  A("SAN", "San Diego", "San Diego", "US", 32.734, -117.190),
  A("PDX", "Portland", "Portland", "US", 45.589, -122.594),
  A("HNL", "Honolulu", "Honolulu", "US", 21.319, -157.922),
  A("MCO", "Orlando", "Orlando", "US", 28.431, -81.308),
  A("SLC", "Salt Lake City", "Salt Lake City", "US", 40.790, -111.979),
  A("MSY", "New Orleans", "New Orleans", "US", 29.993, -90.258),
  A("BNA", "Nashville", "Nashville", "US", 36.124, -86.678),
  // Canada
  A("YYZ", "Toronto Pearson", "Toronto", "CA", 43.678, -79.625),
  A("YVR", "Vancouver", "Vancouver", "CA", 49.195, -123.184),
  A("YUL", "Montreal Trudeau", "Montreal", "CA", 45.470, -73.741),
  // Mexico, Central America & Caribbean
  A("MEX", "Mexico City", "Mexico City", "MX", 19.436, -99.072),
  A("CUN", "Cancun", "Cancun", "MX", 21.037, -86.877),
  A("GDL", "Guadalajara", "Guadalajara", "MX", 20.522, -103.311),
  A("SJO", "San Jose Juan Santamaria", "San Jose", "CR", 9.994, -84.209),
  A("PTY", "Panama City Tocumen", "Panama City", "PA", 9.071, -79.383),
  A("SJU", "San Juan", "San Juan", "PR", 18.439, -66.002),
  A("PUJ", "Punta Cana", "Punta Cana", "DO", 18.567, -68.363),
  A("MBJ", "Montego Bay", "Montego Bay", "JM", 18.504, -77.913),
  A("NAS", "Nassau", "Nassau", "BS", 25.039, -77.466),
  // South America
  A("BOG", "Bogota El Dorado", "Bogota", "CO", 4.702, -74.147),
  A("LIM", "Lima", "Lima", "PE", -12.022, -77.114),
  A("GRU", "Sao Paulo Guarulhos", "Sao Paulo", "BR", -23.435, -46.473),
  A("GIG", "Rio de Janeiro Galeao", "Rio de Janeiro", "BR", -22.809, -43.244),
  A("EZE", "Buenos Aires Ezeiza", "Buenos Aires", "AR", -34.822, -58.536),
  A("SCL", "Santiago", "Santiago", "CL", -33.393, -70.786),
  // Europe
  A("LHR", "London Heathrow", "London", "GB", 51.470, -0.454),
  A("LGW", "London Gatwick", "London", "GB", 51.153, -0.182),
  A("CDG", "Paris Charles de Gaulle", "Paris", "FR", 49.010, 2.548),
  A("ORY", "Paris Orly", "Paris", "FR", 48.723, 2.379),
  A("AMS", "Amsterdam Schiphol", "Amsterdam", "NL", 52.310, 4.768),
  A("FRA", "Frankfurt", "Frankfurt", "DE", 50.038, 8.562),
  A("MUC", "Munich", "Munich", "DE", 48.354, 11.786),
  A("BER", "Berlin Brandenburg", "Berlin", "DE", 52.366, 13.503),
  A("MAD", "Madrid Barajas", "Madrid", "ES", 40.472, -3.561),
  A("BCN", "Barcelona El Prat", "Barcelona", "ES", 41.297, 2.078),
  A("FCO", "Rome Fiumicino", "Rome", "IT", 41.800, 12.239),
  A("MXP", "Milan Malpensa", "Milan", "IT", 45.630, 8.723),
  A("LIS", "Lisbon", "Lisbon", "PT", 38.774, -9.134),
  A("DUB", "Dublin", "Dublin", "IE", 53.421, -6.270),
  A("ZRH", "Zurich", "Zurich", "CH", 47.458, 8.548),
  A("VIE", "Vienna", "Vienna", "AT", 48.110, 16.570),
  A("CPH", "Copenhagen", "Copenhagen", "DK", 55.618, 12.656),
  A("ARN", "Stockholm Arlanda", "Stockholm", "SE", 59.650, 17.919),
  A("OSL", "Oslo Gardermoen", "Oslo", "NO", 60.194, 11.100),
  A("HEL", "Helsinki", "Helsinki", "FI", 60.317, 24.963),
  A("ATH", "Athens", "Athens", "GR", 37.936, 23.947),
  A("IST", "Istanbul", "Istanbul", "TR", 41.275, 28.752),
  A("PRG", "Prague", "Prague", "CZ", 50.101, 14.260),
  A("KEF", "Reykjavik Keflavik", "Reykjavik", "IS", 63.985, -22.606),
  A("BRU", "Brussels", "Brussels", "BE", 50.901, 4.484),
  A("WAW", "Warsaw Chopin", "Warsaw", "PL", 52.166, 20.967),
  A("BUD", "Budapest", "Budapest", "HU", 47.439, 19.262),
  // Middle East & Africa
  A("DXB", "Dubai", "Dubai", "AE", 25.253, 55.366),
  A("AUH", "Abu Dhabi", "Abu Dhabi", "AE", 24.433, 54.651),
  A("DOH", "Doha Hamad", "Doha", "QA", 25.273, 51.608),
  A("TLV", "Tel Aviv Ben Gurion", "Tel Aviv", "IL", 32.011, 34.887),
  A("CAI", "Cairo", "Cairo", "EG", 30.122, 31.406),
  A("JNB", "Johannesburg O.R. Tambo", "Johannesburg", "ZA", -26.139, 28.246),
  A("CPT", "Cape Town", "Cape Town", "ZA", -33.965, 18.602),
  A("NBO", "Nairobi Jomo Kenyatta", "Nairobi", "KE", -1.319, 36.928),
  A("CMN", "Casablanca", "Casablanca", "MA", 33.367, -7.590),
  A("RAK", "Marrakesh", "Marrakesh", "MA", 31.607, -8.036),
  A("ADD", "Addis Ababa Bole", "Addis Ababa", "ET", 8.978, 38.799),
  // Asia
  A("NRT", "Tokyo Narita", "Tokyo", "JP", 35.772, 140.393),
  A("HND", "Tokyo Haneda", "Tokyo", "JP", 35.549, 139.780),
  A("KIX", "Osaka Kansai", "Osaka", "JP", 34.427, 135.244),
  A("ITM", "Osaka Itami", "Osaka", "JP", 34.785, 135.438),
  A("NGO", "Nagoya Chubu", "Nagoya", "JP", 34.858, 136.805),
  A("CTS", "Sapporo New Chitose", "Sapporo", "JP", 42.775, 141.692),
  A("FUK", "Fukuoka", "Fukuoka", "JP", 33.585, 130.451),
  A("OKA", "Okinawa Naha", "Okinawa", "JP", 26.196, 127.646),
  A("ICN", "Seoul Incheon", "Seoul", "KR", 37.460, 126.441),
  A("GMP", "Seoul Gimpo", "Seoul", "KR", 37.558, 126.791),
  A("PEK", "Beijing Capital", "Beijing", "CN", 40.080, 116.585),
  A("PVG", "Shanghai Pudong", "Shanghai", "CN", 31.143, 121.805),
  A("HKG", "Hong Kong", "Hong Kong", "HK", 22.308, 113.918),
  A("TPE", "Taipei Taoyuan", "Taipei", "TW", 25.078, 121.233),
  A("SIN", "Singapore Changi", "Singapore", "SG", 1.364, 103.991),
  A("BKK", "Bangkok Suvarnabhumi", "Bangkok", "TH", 13.690, 100.750),
  A("DMK", "Bangkok Don Mueang", "Bangkok", "TH", 13.913, 100.607),
  A("HKT", "Phuket", "Phuket", "TH", 8.113, 98.317),
  A("KUL", "Kuala Lumpur", "Kuala Lumpur", "MY", 2.746, 101.710),
  A("CGK", "Jakarta Soekarno-Hatta", "Jakarta", "ID", -6.126, 106.656),
  A("DPS", "Bali Ngurah Rai", "Bali", "ID", -8.748, 115.167),
  A("MNL", "Manila Ninoy Aquino", "Manila", "PH", 14.509, 121.020),
  A("SGN", "Ho Chi Minh City", "Ho Chi Minh City", "VN", 10.819, 106.652),
  A("HAN", "Hanoi Noi Bai", "Hanoi", "VN", 21.221, 105.807),
  A("DEL", "Delhi Indira Gandhi", "Delhi", "IN", 28.556, 77.100),
  A("BOM", "Mumbai", "Mumbai", "IN", 19.090, 72.866),
  A("BLR", "Bengaluru", "Bengaluru", "IN", 13.199, 77.706),
  A("CMB", "Colombo", "Colombo", "LK", 7.181, 79.884),
  A("KTM", "Kathmandu", "Kathmandu", "NP", 27.697, 85.359),
  A("MLE", "Male Velana", "Male", "MV", 4.192, 73.529),
  // Oceania
  A("SYD", "Sydney Kingsford Smith", "Sydney", "AU", -33.946, 151.177),
  A("MEL", "Melbourne", "Melbourne", "AU", -37.669, 144.841),
  A("BNE", "Brisbane", "Brisbane", "AU", -27.384, 153.117),
  A("PER", "Perth", "Perth", "AU", -31.940, 115.967),
  A("AKL", "Auckland", "Auckland", "NZ", -37.008, 174.792),
  A("CHC", "Christchurch", "Christchurch", "NZ", -43.489, 172.532),
  A("NAN", "Nadi", "Nadi", "FJ", -17.755, 177.443),
  A("PPT", "Papeete Tahiti", "Papeete", "PF", -17.554, -149.607),
];

export const AIRPORT_BY_IATA: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.iata, a]));

export const REGIONS: Region[] = [
  "North America",
  "Central America & Caribbean",
  "South America",
  "Europe",
  "Middle East",
  "Africa",
  "Asia",
  "Oceania",
];

export function regionOf(iata: string): Region | undefined {
  const a = AIRPORT_BY_IATA[iata];
  return a ? COUNTRIES[a.country]?.region : undefined;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
