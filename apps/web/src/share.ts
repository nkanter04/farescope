import { TripShareSchema, tripTotal, type TripPlan } from "@farescope/shared";

const MAX_BYTES = 150_000;

async function transform(bytes: Uint8Array, compress: boolean): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(compress ? new CompressionStream("deflate") : new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw new Error("This shared itinerary is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function createShareLink(trips: TripPlan[], base = window.location.href): Promise<string> {
  const data = TripShareSchema.parse({ version: 1, trips });
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if (raw.length > MAX_BYTES) throw new Error("This itinerary is too large to share. Shorten the notes or share one trip at a time.");
  const compressed = await transform(raw, true);
  const encoded = btoa(Array.from(compressed, byte => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (encoded.length > 24000) throw new Error("This link is too long. Shorten the notes or share one trip at a time.");
  const url = new URL(base);
  url.hash = `share=${encoded}`;
  return url.href;
}

export async function readShareLink(hash: string): Promise<TripPlan[]> {
  const encoded = hash.replace(/^#share=/, "");
  if (!encoded || encoded.length > 24000 || !/^[\w-]+$/.test(encoded)) throw new Error("Invalid sharing link.");
  const bytes = Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  const data = TripShareSchema.parse(JSON.parse(new TextDecoder().decode(await transform(bytes, false))));
  return data.trips.map(trip => ({ ...trip, total: tripTotal(trip) }));
}
