import { logger } from "../logger.js";

/**
 * Best-effort IP → country/city lookup using ip-api.com's free tier (45 req/min,
 * no auth required). We deliberately don't fail hard — geo data is purely
 * for the Security panel's "device origin" label, so a missing lookup just
 * leaves the columns null.
 *
 * Localhost / private IPs are short-circuited because the provider would
 * just return "reserved range" anyway. Everything is timed-out at 3s to keep
 * the sign-in path snappy.
 */

interface IpApiResponse {
  status: "success" | "fail";
  country?: string;
  city?: string;
  message?: string;
}

export interface GeoResult {
  country: string | null;
  city: string | null;
}

const PRIVATE_PREFIXES = [
  "127.",
  "10.",
  "192.168.",
  "::1",
  "fe80:",
  "fc00:",
  "fd00:",
];

function isPrivate(ip: string): boolean {
  if (!ip) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return PRIVATE_PREFIXES.some((p) => ip.startsWith(p));
}

export async function lookupIp(
  ip: string | null | undefined,
): Promise<GeoResult> {
  if (!ip || isPrivate(ip)) {
    return { country: null, city: null };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,message`,
      { signal: ctl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return { country: null, city: null };
    const data = (await res.json()) as IpApiResponse;
    if (data.status !== "success") {
      logger.debug({ ip, msg: data.message }, "geo lookup failed");
      return { country: null, city: null };
    }
    return {
      country: data.country ?? null,
      city: data.city ?? null,
    };
  } catch (err) {
    logger.debug(
      { ip, err: err instanceof Error ? err.message : String(err) },
      "geo lookup error",
    );
    return { country: null, city: null };
  }
}
