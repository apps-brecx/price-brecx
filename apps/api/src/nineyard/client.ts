import { env } from "../env.js";
import { logger } from "../logger.js";
import type {
  NyApiSku,
  NyItemsResponse,
  NySkuMapping,
  NyToken,
} from "./types.js";

/**
 * NineYard REST client.
 *
 * Auth model: POST /api/OAuth/UsernameToken with { email, password, companyId }
 * returns a JWT valid for ~500 days. We cache it in-memory and re-login on
 * 401 — that's the only failure mode where the token is the cause, so a
 * single auto-retry keeps the sync loop resilient to mid-run expiry.
 *
 * Pagination: /api/Skus uses `PageNumber` (1-based, 100 rows/page);
 *             /api/Items uses `Page` + `PerPage`. We expose iterators so the
 *             sync layer doesn't have to know either convention.
 */

export function nineyardReady(): boolean {
  return !!(env.NY_EMAIL && env.NY_PASSWORD && env.NY_COMPANY_ID);
}

interface TokenCache {
  token: string;
  expiresAt: number;
}
let cached: TokenCache | null = null;

async function login(): Promise<TokenCache> {
  if (!nineyardReady()) {
    throw new Error("NineYard credentials missing (NY_EMAIL, NY_PASSWORD, NY_COMPANY_ID)");
  }
  const url = `${env.NINEYARD_BASE}/api/OAuth/UsernameToken`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.NY_EMAIL,
      password: env.NY_PASSWORD,
      companyId: env.NY_COMPANY_ID,
    }),
  });
  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new Error(
      `NineYard login failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as NyToken;
  if (!data.accessToken) throw new Error("NineYard login returned empty accessToken");

  // expiresIn comes back in *milliseconds* despite the swagger naming —
  // 43200000 ≈ 500 days. We treat the wall-clock `expires` field as the
  // source of truth and subtract a 60s buffer so we re-login before the
  // server starts rejecting requests.
  const wallExp = data.expires ? new Date(data.expires).getTime() : 0;
  const expiresAt =
    wallExp > Date.now() + 60_000
      ? wallExp - 60_000
      : Date.now() + 30 * 60 * 1000; // fallback 30min if `expires` looks off
  cached = { token: data.accessToken, expiresAt };
  logger.info({ exp: new Date(expiresAt).toISOString() }, "NineYard login ok");
  return cached;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  return (await login()).token;
}

/** Thin authenticated fetch with one-shot retry on 401 (token rotated). */
async function nyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.NINEYARD_BASE}${path}`;
  let token = await getToken();
  let res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    token = await getToken(true);
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new Error(
      `NineYard ${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

async function safeReadBody(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

/* --------------------------- public API --------------------------- */

/**
 * One page of /api/Skus. NineYard fixes 100 rows/page; an empty array signals
 * end-of-data.
 */
export function listSkusPage(pageNumber: number): Promise<NyApiSku[]> {
  return nyFetch<NyApiSku[]>(`/api/Skus?PageNumber=${pageNumber}`);
}

/** Async iterator over every /api/Skus page until the server returns []. */
export async function* iterateAllSkus(): AsyncGenerator<NyApiSku[], void, void> {
  let page = 1;
  while (true) {
    const rows = await listSkusPage(page);
    if (!rows.length) return;
    yield rows;
    page++;
  }
}

/** One page of /api/Items. perPage caps at NineYard's max (~200). */
export function listItemsPage(page: number, perPage = 100): Promise<NyItemsResponse> {
  return nyFetch<NyItemsResponse>(
    `/api/Items?Page=${page}&PerPage=${perPage}`,
  );
}

/** Iterate every /api/Items page until totalPages exhausted. */
export async function* iterateAllItems(perPage = 100) {
  const first = await listItemsPage(1, perPage);
  yield first.itemMapping;
  for (let p = 2; p <= first.totalPages; p++) {
    const next = await listItemsPage(p, perPage);
    yield next.itemMapping;
  }
}

/**
 * Bulk lookup of accountSkuId → master itemId mappings. NineYard accepts the
 * `AccountSkuIds` query as a repeated param. We chunk because the upstream
 * proxy rejects URLs over a (conservatively low) threshold with a misleading
 * 404 instead of 414 — empirical tests show 50 IDs per request is safe,
 * 200 reliably fails.
 *
 * Failures on a single chunk are logged and skipped rather than rethrown:
 * partial mappings still give the Pricing page useful data, and one bad
 * chunk shouldn't lose the work of the previous (potentially expensive) sync
 * stages.
 */
export async function getSkuMappings(
  accountSkuIds: number[],
  chunkSize = 50,
): Promise<NySkuMapping[]> {
  const out: NySkuMapping[] = [];
  let failedChunks = 0;
  for (let i = 0; i < accountSkuIds.length; i += chunkSize) {
    const chunk = accountSkuIds.slice(i, i + chunkSize);
    const qs = chunk.map((id) => `AccountSkuIds=${id}`).join("&");
    try {
      const rows = await nyFetch<NySkuMapping[]>(
        `/api/Skus/GetSkuMappings?${qs}`,
      );
      out.push(...rows);
    } catch (err) {
      failedChunks++;
      logger.warn(
        {
          chunkStart: i,
          chunkSize: chunk.length,
          err: err instanceof Error ? err.message : String(err),
        },
        "NineYard mapping chunk failed — continuing with remaining chunks",
      );
    }
  }
  if (failedChunks > 0) {
    logger.warn(
      { failedChunks, totalIds: accountSkuIds.length },
      "Some NineYard mapping chunks failed",
    );
  }
  return out;
}
