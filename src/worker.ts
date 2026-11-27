import { countUniqueAmundiProducts, discoverAmundiPaginationLinks, extractAmundiTotal, parseAmundiRows } from "./lib/amundi-parser";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const AMUNDI_SOURCE = "https://www.amundietf.fr/fr/particuliers/produits-etf/recherche";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });

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
      ? products.filter(product => [product.name, product.isin, product.ticker, product.wkn, product.exposure].some(value => value.toLowerCase().includes(search)))
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
      return json({ status: "not_found", path: url.pathname }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
