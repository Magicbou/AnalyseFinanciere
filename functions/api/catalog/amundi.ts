import {
  buildAmundiPageUrls,
  countUniqueAmundiProducts,
  discoverAmundiPaginationLinks,
  extractAmundiTotal,
  parseAmundiRows
} from "../../../src/lib/amundi-parser";

type PagesContext = { request: Request };
const SOURCE_URL = "https://www.amundietf.fr/fr/professionnels/produits-etf/recherche";
const PAGE_SIZE = 50;
const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "Mozilla/5.0 (compatible; InvestPilot/0.5; +catalogue source attribution)",
  Referer: SOURCE_URL
};

function dateValue(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

export async function onRequestGet({ request }: PagesContext): Promise<Response> {
  const search = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  try {
    const firstResponse = await fetch(SOURCE_URL, { headers: HEADERS });
    if (!firstResponse.ok) {
      return Response.json({ status: "source_unavailable", source: SOURCE_URL, upstreamStatus: firstResponse.status, products: [] }, { status: 502 });
    }

    const firstPage = await firstResponse.text();
    const sourceTotal = extractAmundiTotal(firstPage);
    // Amundi renders 50 products on the initial page, but its pager is a JS
    // control rather than ordinary href links. Build the numbered pages too.
    const pageUrls = [...new Set([
      ...discoverAmundiPaginationLinks(firstPage, SOURCE_URL),
      ...buildAmundiPageUrls(SOURCE_URL, sourceTotal, PAGE_SIZE)
    ])].filter(url => {
      try {
        const parsed = new URL(url);
        return parsed.origin === new URL(SOURCE_URL).origin && parsed.pathname === new URL(SOURCE_URL).pathname;
      } catch { return false; }
    });

    const pageResults = await Promise.all(pageUrls.map(async url => {
      try {
        const response = await fetch(url, { headers: HEADERS });
        return response.ok ? { url, html: await response.text(), failed: false } : { url, html: "", failed: true };
      } catch {
        return { url, html: "", failed: true };
      }
    }));

    const htmlPages = [firstPage];
    let failedPages = pageResults.filter(page => page.failed).length;
    const seenPageBodies = new Set([firstPage]);
    for (const page of pageResults) {
      if (page.failed || !page.html) continue;
      // Some upstream/CDN responses ignore the pager query. Do not count the
      // same first page repeatedly as successful pagination.
      if (seenPageBodies.has(page.html)) {
        failedPages += 1;
        continue;
      }
      seenPageBodies.add(page.html);
      htmlPages.push(page.html);
    }

    const rows = htmlPages.flatMap(html => parseAmundiRows(html, SOURCE_URL));
    const uniqueListings = [...new Map(rows.map(product => [product.isin + "|" + product.ticker, product])).values()];
    const productCount = countUniqueAmundiProducts(uniqueListings);
    const filtered = search
      ? uniqueListings.filter(product => [product.name, product.isin, product.ticker, product.wkn, product.exposure].some(value => value.toLowerCase().includes(search)))
      : uniqueListings;

    const navDates = uniqueListings.map(product => product.navDate).filter((value): value is string => Boolean(value));
    const dated = navDates.map(value => ({ value, timestamp: dateValue(value) })).filter((item): item is { value: string; timestamp: number } => item.timestamp !== null);
    const sortedDates = [...dated].sort((a, b) => a.timestamp - b.timestamp);
    const expectedPages = sourceTotal === null ? null : Math.ceil(sourceTotal / PAGE_SIZE);
    const allExpectedPagesFetched = expectedPages !== null && htmlPages.length === expectedPages;
    const completeness = sourceTotal !== null && productCount === sourceTotal && failedPages === 0 && allExpectedPagesFetched
      ? "complete" : "partial";

    return Response.json({
      status: uniqueListings.length ? "ok" : "unparsed_source",
      source: SOURCE_URL,
      retrievedAt: new Date().toISOString(),
      sourceTotal,
      productCount,
      listingCount: uniqueListings.length,
      returnedCount: filtered.length,
      pageCount: htmlPages.length,
      completeness,
      audit: {
        officialProductTotal: sourceTotal,
        uniqueIsinCount: productCount,
        parsedListingCount: rows.length,
        uniqueListingCount: uniqueListings.length,
        duplicateListingRows: rows.length - uniqueListings.length,
        discoveredAdditionalPages: pageUrls.length,
        fetchedPages: htmlPages.length,
        failedPages,
        missingNavCount: uniqueListings.filter(product => !product.nav).length,
        navWithoutPublicationDateCount: uniqueListings.filter(product => product.nav && !product.navDate).length,
        oldestNavDate: sortedDates[0]?.value ?? null,
        newestNavDate: sortedDates[sortedDates.length - 1]?.value ?? null,
        completenessRule: "Complet uniquement si tous les lots attendus sont récupérés, sans page en échec, et si le nombre d'ISIN distincts égale le total officiel Amundi."
      },
      notice: "Les valeurs liquidatives Amundi sont des valeurs publiées par l'émetteur, pas des cours de marché en temps réel. Les cours de marché sont fournis séparément lorsqu'une source de cotation les publie.",
      products: filtered
    }, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=900",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json({ status: "source_unavailable", source: SOURCE_URL, products: [] }, { status: 502 });
  }
}
