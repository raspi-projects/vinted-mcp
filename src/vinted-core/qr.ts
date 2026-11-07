import { runtimeRequire } from "./auth/utils";

/**
 * QR labels on garments. Recent Ralph Lauren pieces carry a gold (sometimes blue) label whose
 * QR code links into RL's digital product ID system (q-rl.us, or the
 * EVRYTHNG/Digimarc short-link domain tn.gg it runs on); each garment's code
 * is unique. Codes are only decoded here, never followed: following one
 * records a scan in RL's system, which is the buyer's own step.
 */

let reader: Promise<any> | null = null;

function loadReader(): Promise<any> {
  if (!reader) {
    reader = (async () => {
      const zxing = runtimeRequire("zxing-wasm/reader");
      const fs = require("fs");
      // Node can't fetch the module's .wasm from a CDN the way browsers do; hand it the file.
      const wasmPath = (require as any).resolve("zxing-wasm/reader/zxing_reader.wasm");
      zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(wasmPath) }, fireImmediately: true });
      return zxing;
    })();
    reader.catch(() => (reader = null));
  }
  return reader;
}

/** QR code texts in a JPEG or PNG (the decoder can't read WebP). */
export async function readQrCodes(image: Uint8Array): Promise<string[]> {
  const zxing = await loadReader();
  const results = await zxing.readBarcodes(image, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 3 });
  return [...new Set<string>(results.map((result: any) => result.text).filter(Boolean))];
}

const RL_HOSTS = [/^q-rl\.us$/i, /(^|\.)tn\.gg$/i];

export type QrIssuer = "ralph-lauren" | "other-site" | "not-a-link";

export function qrIssuer(text: string): { issuer: QrIssuer; host: string | null } {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { issuer: "not-a-link", host: null };
  }
  const host = url.hostname.toLowerCase();
  return { issuer: RL_HOSTS.some((pattern) => pattern.test(host)) ? "ralph-lauren" : "other-site", host };
}

interface SeenListing {
  itemId: number;
  sellerId: number | null;
  seenAt: string;
}

interface Registry {
  codes: Record<string, SeenListing[]>;
  scans: Record<string, { checkedAt: string; photosChecked: number; originals: boolean; codes: Array<{ photo: number; text: string }> }>;
}

const SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SCANS = 5000;

/**
 * Remembers which listings each code was seen in, so a code that turns up in
 * a second listing (a genuine label cloned onto fakes) can be flagged, and
 * caches scans so the hub can re-show a listing without fetching its photos.
 */
export class QrRegistry {
  constructor(private readonly file: string = defaultRegistryFile()) {}

  cachedScan(itemId: number) {
    const scan = this.read().scans[String(itemId)];
    return scan && Date.now() - Date.parse(scan.checkedAt) < SCAN_TTL_MS ? scan : null;
  }

  /** Records a scan and returns, per code, the other listings it was seen in. */
  record(itemId: number, sellerId: number | null, scan: Registry["scans"][string]): Record<string, SeenListing[]> {
    const registry = this.read();
    registry.scans[String(itemId)] = scan;

    const others: Record<string, SeenListing[]> = {};
    for (const { text } of scan.codes) {
      const seen = (registry.codes[text] ||= []);
      if (!seen.some((entry) => entry.itemId === itemId)) {
        seen.push({ itemId, sellerId, seenAt: scan.checkedAt });
      }
      others[text] = seen.filter((entry) => entry.itemId !== itemId);
    }

    const keys = Object.keys(registry.scans);
    if (keys.length > MAX_SCANS) {
      keys
        .sort((a, b) => Date.parse(registry.scans[a].checkedAt) - Date.parse(registry.scans[b].checkedAt))
        .slice(0, keys.length - MAX_SCANS)
        .forEach((key) => delete registry.scans[key]);
    }
    this.write(registry);
    return others;
  }

  /** Other listings showing this code; sameSeller tells relisting (common on Vinted) from cloning. */
  otherListings(text: string, itemId: number): Array<{ itemId: number; sameSeller: boolean }> {
    const seen = this.read().codes[text] || [];
    const seller = seen.find((entry) => entry.itemId === itemId)?.sellerId ?? null;
    return seen
      .filter((entry) => entry.itemId !== itemId)
      .map((entry) => ({ itemId: entry.itemId, sameSeller: seller !== null && entry.sellerId === seller }));
  }

  private read(): Registry {
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { codes: data.codes || {}, scans: data.scans || {} };
    } catch {
      return { codes: {}, scans: {} };
    }
  }

  private write(registry: Registry): void {
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(registry));
    fs.renameSync(temp, this.file);
  }
}

function defaultRegistryFile(): string {
  const path = require("path");
  const os = require("os");
  const root = process.env.VINTED_PROFILE_DIR?.trim() || path.join(os.homedir(), ".vinted-mcp");
  return path.join(root, "qr-seen.json");
}
