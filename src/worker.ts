import { countUniqueAmundiProducts, discoverAmundiPaginationLinks, extractAmundiTotal, parseAmundiRows } from "./lib/amundi-parser";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const AMUNDI_SOURCE = "https://www.amundietf.fr/fr/particuliers/produits-etf/recherche";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });


const ECB_CURRENCIES = ["USD", "GBP", "CHF", "JPY"] as const;
async function getEcbFx(): Promise<Response> {
  const retrievedAt = new Date().toISOString();
  const observations = await Promise.all(ECB_CURRENCIES.map(async currency => {
    const url = new URL(`https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A`);
    url.searchParams.set("format", "csvdata");
    url.searchParams.set("lastNObservations", "1");
    try {
      const response = await fetch(url, { headers: { Accept: "text/csv" } });
      if (!response.ok) return { currency, rate: null, observationDate: null, status: "source_unavailable" };
      const csv = await response.text();
      const lines = csv.trim().split(/\r?\n/);
      if (lines.length < 2) return { currency, rate: null, observationDate: null, status: "no_observation" };
      const headers = lines[0].split(",");
      const dateIndex = headers.indexOf("TIME_PERIOD");
      const valueIndex = headers.indexOf("OBS_VALUE");
      if (dateIndex < 0 || valueIndex < 0) return { currency, rate: null, observationDate: null, status: "unrecognized_format" };
      const row = lines.slice(1).reverse().find(line => line.trim().length > 0);
      if (!row) return { currency, rate: null, observationDate: null, status: "no_observation" };
      const fields = row.split(",");
      const observationDate = fields[dateIndex];
      const parsed = Number(fields[valueIndex]);
      if (!/^\d{4}-\\d{2}-\\d{2}$/.test(observationDate || "") || !Number.isFinite(parsed) || parsed <= 0) {
        return { currency, rate: null, observationDate: null, status: "invalid_observation" };
      }
      const ageDays = (Date.parse(retrievedAt.slice(0, 10)) - Date.parse(observationDate)) / 86400000;
      if (ageDays < 0 || ageDays > 7) return { currency, rate: null, observationDate, status: "stale" };
      return { currency, rate: parsed, observationDate, status: "ok" };
    } catch {
      return { currency, rate: null, observationDate: null, status: "source_unavailable" };
    }
  }));
  return json({
    status: observations.some(item => item.status === "ok") ? "ok" : "unavailable",
    source: "European Central Bank Data Portal · EXR daily reference rates",
    sourceUrl: "https://data.ecb.europa.eu/data/datasets/EXR",
    baseCurrency: "EUR",
    retrievedAt,
    freshnessPolicy: "Observations older than 7 calendar days are withheld from display.",
    observations
  }, 200, { "Cache-Control": "public, max-age=900, s-maxage=1800" });
}

async function getAmundiCatalog(request: Request): Promise<Response> {
  const search = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  try {
    const headers = { Accept: "text/html", "User-Agent": "InvestPilot/0.3 (+catalogue source attribution)" };
    const upstream = await fetch(AMUNDI_SOURCE, { headers });
    if (!upstream.ok) {
      return json({ status: "source_unavailable", source: AMUNDI_SOURCE, upstreamStatus: upstream.status, products: [] }, 502);
    }
    const firstPage = await upstream.text();
    const pages = [firstPage];
    for (const pageUrl of discoverAmundiPaginationLinks(firstPage, AMUNDI_SOURCE)) {
      const pageResponse = await fetch(pageUrl, { headers });
      if (pageResponse.ok) pages.push(await pageResponse.text());
    }
    const rows = pages.flatMap(html => parseAmundiRows(html, AMUNDI_SOURCE));
    const products = [...new Map(rows.map(row => [row.isin + "|" + row.ticker, row])).values()];
    const sourceTotal = extractAmundiTotal(firstPage);
    const productCount = countUniqueAmundiProducts(products);
    const filtered = search
      ? products.filter(product => [product.name, product.isin, product.ticker, product.wkn, product.exposure].some(value => value?.toLowerCase().includes(search) ?? false))
      : products;
    return json({
      status: products.length ? "ok" : "unparsed_source",
      source: AMUNDI_SOURCE,
      retrievedAt: new Date().toISOString(),
      sourceTotal,
      productCount,
      listingCount: products.length,
      returnedCount: filtered.length,
      pageCount: pages.length,
      completeness: sourceTotal !== null && productCount === sourceTotal ? "complete" : "partial",
      notice: "Les valeurs liquidatives Amundi ne sont pas des cours de marché en temps réel. Aucun cours live n'est fourni par cet endpoint.",
      products: filtered
    }, 200, { "Cache-Control": "public, max-age=300, s-maxage=900" });
  } catch {
    return json({ status: "source_unavailable", source: AMUNDI_SOURCE, products: [] }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return json({ status: "method_not_allowed" }, 405, { Allow: "GET" });
      if (url.pathname === "/api/health") {
        return json({ status: "ok", service: "investpilot-api", version: "0.3.0", timestamp: new Date().toISOString() });
      }
      if (url.pathname === "/api/catalog/amundi") return getAmundiCatalog(request);
      if (url.pathname === "/api/market/fx") return getEcbFx();
      return json({ status: "not_found", path: url.pathname }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
