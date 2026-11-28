export type AmundiCatalogRow = {
  ticker: string; wkn: string; name: string; isin: string; currency: string;
  ongoingCharges: string | null; assetsUnderManagement: string | null; sfdr: string | null;
  exposure: string | null; nav: string | null; navDate: string | null;
  performanceYtd: string | null; performance1y: string | null; sourceUrl: string;
};
function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&euro;/gi, "€")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
export function parseAmundiRows(html: string, sourceUrl: string): AmundiCatalogRow[] {
  const marker = html.indexOf("ETF_FINDER_SUMMARY");
  const source = marker >= 0 ? html.slice(marker) : html;
  const rows = source.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const output: AmundiCatalogRow[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => clean(match[1]));
    if (cells.length < 12) continue;
    const ticker = cells[0] ?? "";
    const productLabel = cells[2] ?? "";
    const isinMatch = productLabel.match(/\bISIN(?:\s+code)?\s+([A-Z]{2}[A-Z0-9]{10})\b/i);
    if (!ticker || !isinMatch) continue;
    const navMatch = (cells[9] ?? "").match(/^([\d.,-]+)\s+(\d{2}\/\d{2}\/\d{4})$/);
    output.push({
      ticker, wkn: cells[1] ?? "",
      name: productLabel.replace(/\s+Code\s+ISIN.*$/i, "").replace(/\s+ISIN(?:\s+code)?\s+[A-Z]{2}[A-Z0-9]{10}/i, "").trim(),
      isin: isinMatch[1].toUpperCase(), currency: cells[3] ?? "", ongoingCharges: cells[4] || null,
      assetsUnderManagement: cells[5] || null, sfdr: cells[6] || null, exposure: cells[8] || null,
      nav: navMatch?.[1] ?? null, navDate: navMatch?.[2] ?? null,
      performanceYtd: cells[10] || null, performance1y: cells[11] || null, sourceUrl
    });
  }
  return output;
}
/** Count distinct Amundi products, not exchange listings: one ISIN may have several tickers. */
export function countUniqueAmundiProducts(rows: Pick<AmundiCatalogRow, "isin">[]): number {
  return new Set(rows.map(row => row.isin.trim().toUpperCase()).filter(Boolean)).size;
}
export function extractAmundiTotal(html: string): number | null {
  // Amundi may wrap the number and label in separate spans. Parse visible text,
  // not raw HTML tag boundaries.
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const matches = [...text.matchAll(/([\d\s]+)\s*produit\s*(?:\(s\)|s)?\s*trouv(?:é|e)\s*(?:\(s\)|s)?/gi)];
  const totals = matches.map(match => Number(match[1].replace(/\s/g, ""))).filter(Number.isSafeInteger);
  return totals.length ? Math.max(...totals) : null;
}
export function discoverAmundiPaginationLinks(html: string, sourceUrl: string): string[] {
  const base = new URL(sourceUrl);
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const candidate = new URL(match[1], sourceUrl);
      if (candidate.origin === base.origin && candidate.pathname === base.pathname && /(?:[?&])page=\d+/i.test(candidate.search)) links.add(candidate.toString());
    } catch { /* Ignore malformed links. */ }
  }
  return [...links].slice(0, 20);
}

/** Amundi currently exposes 50 result rows per page. The first page has no
 * pager query; subsequent pages use the standard zero-based ?page= parameter. */
export function buildAmundiPageUrls(sourceUrl: string, officialTotal: number | null, pageSize = 50): string[] {
  if (!officialTotal || officialTotal <= pageSize || !Number.isInteger(pageSize) || pageSize < 1) return [];
  const base = new URL(sourceUrl);
  const pageCount = Math.ceil(officialTotal / pageSize);
  const urls: string[] = [];
  for (let page = 1; page < pageCount; page += 1) {
    const url = new URL(base);
    url.searchParams.set("page", String(page));
    urls.push(url.toString());
  }
  return urls;
}
