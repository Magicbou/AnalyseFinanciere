import { countUniqueAmundiProducts, discoverAmundiPaginationLinks, extractAmundiTotal, parseAmundiRows } from "../../../src/lib/amundi-parser";

type PagesContext = { request: Request };
const SOURCE_URL = "https://www.amundietf.fr/fr/particuliers/produits-etf/recherche";

export async function onRequestGet({ request }: PagesContext): Promise<Response> {
  const search = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  try {
    const response = await fetch(SOURCE_URL, { headers: { Accept: "text/html", "User-Agent": "InvestPilot/0.1 (+catalogue source attribution)" } });
    if (!response.ok) return Response.json({ status: "source_unavailable", source: SOURCE_URL, upstreamStatus: response.status, products: [] }, { status: 502 });
    const firstPage = await response.text();
    const htmlPages = [firstPage];
    for (const pageUrl of discoverAmundiPaginationLinks(firstPage, SOURCE_URL)) {
      const pageResponse = await fetch(pageUrl, { headers: { Accept: "text/html", "User-Agent": "InvestPilot/0.1 (+catalogue source attribution)" } });
      if (pageResponse.ok) htmlPages.push(await pageResponse.text());
    }
    const rows = htmlPages.flatMap(html => parseAmundiRows(html, SOURCE_URL));
    const products = [...new Map(rows.map(product => [product.isin + "|" + product.ticker, product])).values()];
    const sourceTotal = extractAmundiTotal(firstPage);
    const productCount = countUniqueAmundiProducts(products);
    const filtered = search ? products.filter(product => [product.name, product.isin, product.ticker, product.wkn, product.exposure].some(value => value.toLowerCase().includes(search))) : products;
    return Response.json({
      status: products.length ? "ok" : "unparsed_source",
      source: SOURCE_URL, retrievedAt: new Date().toISOString(), sourceTotal,
      productCount, listingCount: products.length, returnedCount: filtered.length, pageCount: htmlPages.length,
      completeness: sourceTotal !== null && productCount === sourceTotal ? "complete" : "partial",
      notice: "Les valeurs liquidatives Amundi ne sont pas des cours de marché en temps réel. Aucun cours live n'est fourni par cet endpoint.",
      products: filtered
    }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=900", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ status: "source_unavailable", source: SOURCE_URL, products: [] }, { status: 502 });
  }
}
