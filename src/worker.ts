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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate || "") || !Number.isFinite(parsed) || parsed <= 0) {
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


const EURONEXT_TRADES_URL = "https://marketdata.euronext.com/data-reporting-service/trades-file/download/ETFS_FUNDS/LAST_HOUR/PAR";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values.map(item => item.trim());
}

async function extractZipText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // Locate the ZIP central directory so data-descriptor archives are supported too.
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new Error("Archive ZIP Euronext non reconnue");
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  for (let entry = 0; entry < entries; entry++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Répertoire ZIP Euronext invalide");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const filename = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (filename.endsWith("/")) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Entrée ZIP Euronext invalide");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 0) return new TextDecoder("utf-8").decode(compressed);
    if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
    }
    throw new Error("Compression ZIP Euronext non prise en charge");
  }
  throw new Error("Aucun fichier CSV dans l'archive Euronext");
}

async function getEuronextTrades(request: Request): Promise<Response> {
  const requested = (new URL(request.url).searchParams.get("isins") || "")
    .split(",").map(value => value.trim().toUpperCase()).filter(value => /^[A-Z]{2}[A-Z0-9]{10}$/.test(value));
  if (!requested.length) return json({ status: "invalid_request", message: "Fournir au moins un ISIN valide." }, 400);
  if (requested.length > 100) return json({ status: "invalid_request", message: "100 ISIN maximum par requête." }, 400);
  const retrievedAt = new Date().toISOString();
  try {
    const response = await fetch(EURONEXT_TRADES_URL, { headers: { Accept: "application/zip,text/csv,*/*", "User-Agent": "InvestPilot/0.3 personal research" } });
    if (!response.ok) return json({
      status: "source_unavailable", source: EURONEXT_TRADES_URL, retrievedAt,
      upstreamStatus: response.status, message: "Euronext n'a pas fourni de fichier de transactions pour cette période/place. Aucun cours n'est affiché."
    }, 502);
    const buffer = await response.arrayBuffer();
    const text = response.headers.get("content-type")?.includes("csv")
      ? new TextDecoder("utf-8").decode(buffer)
      : await extractZipText(buffer);
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    const headerIndex = lines.findIndex(line => /MifidInstrumentID/i.test(line) && /MifidPrice/i.test(line));
    if (headerIndex < 0) return json({ status: "unrecognized_source_format", source: EURONEXT_TRADES_URL, retrievedAt, message: "En-tête CSV Euronext non reconnu. Données rejetées." }, 502);
    const headers = parseCsvLine(lines[headerIndex]).map(value => value.replace(/^"|"$/g, ""));
    const index = (name: string) => headers.findIndex(value => value.toLowerCase() === name.toLowerCase());
    const isinIndex = index("MifidInstrumentID");
    const idTypeIndex = index("MifidInstrumentIdType");
    const priceIndex = index("MifidPrice");
    const currencyIndex = index("MifidCurrency");
    const tradeTimeIndex = index("TradingDateTime");
    const publicationIndex = index("PublicationDateTime");
    const quantityIndex = index("MifidQuantity");
    if ([isinIndex, priceIndex, tradeTimeIndex].some(value => value < 0)) {
      return json({ status: "unrecognized_source_format", source: EURONEXT_TRADES_URL, retrievedAt, headers, message: "Champs essentiels absents. Données rejetées." }, 502);
    }
    const wanted = new Set(requested);
    const latest = new Map<string, Record<string, string>>();
    for (const line of lines.slice(headerIndex + 1)) {
      const fields = parseCsvLine(line);
      const isin = (fields[isinIndex] || "").toUpperCase();
      if (!wanted.has(isin) || (idTypeIndex >= 0 && fields[idTypeIndex] && fields[idTypeIndex] !== "ISIN")) continue;
      const price = Number(fields[priceIndex]);
      const tradeTime = fields[tradeTimeIndex] || "";
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(tradeTime))) continue;
      const previous = latest.get(isin);
      if (!previous || Date.parse(tradeTime) > Date.parse(previous.tradeTime)) {
        latest.set(isin, {
          isin, price: String(price), currency: currencyIndex >= 0 ? fields[currencyIndex] || "" : "",
          tradeTime, publicationTime: publicationIndex >= 0 ? fields[publicationIndex] || "" : "",
          quantity: quantityIndex >= 0 ? fields[quantityIndex] || "" : ""
        });
      }
    }
    return json({
      status: "ok", source: EURONEXT_TRADES_URL, sourceName: "Euronext · transactions différées ETFs & Funds · Paris",
      retrievedAt, delayPolicy: "Données différées d'au plus 15 minutes après publication initiale par Euronext ; horodatages UTC.",
      market: "PAR", period: "LAST_HOUR", results: requested.map(isin => {
        const trade = latest.get(isin);
        return trade ? { ...trade, status: "trade_found" } : { isin, status: "no_trade_in_period", price: null };
      })
    }, 200, { "Cache-Control": "public, max-age=60, s-maxage=60" });
  } catch (error) {
    return json({ status: "source_unavailable", source: EURONEXT_TRADES_URL, retrievedAt, message: error instanceof Error ? error.message : "Erreur de lecture Euronext." }, 502);
  }
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
    const pageLinks = discoverAmundiPaginationLinks(firstPage, AMUNDI_SOURCE);
    const pages = [firstPage];
    let failedPageCount = 0;
    for (const pageUrl of pageLinks) {
      try {
        const pageResponse = await fetch(pageUrl, { headers });
        if (pageResponse.ok) pages.push(await pageResponse.text());
        else failedPageCount += 1;
      } catch {
        failedPageCount += 1;
      }
    }
    const rawRows = pages.flatMap(html => parseAmundiRows(html, AMUNDI_SOURCE));
    const products = [...new Map(rawRows.map(row => [row.isin + "|" + row.ticker, row])).values()];
    const sourceTotal = extractAmundiTotal(firstPage);
    const productCount = countUniqueAmundiProducts(products);
    const navMissingCount = products.filter(product => !product.nav).length;
    const navWithoutDateCount = products.filter(product => Boolean(product.nav) && !product.navDate).length;
    const navDates = products.map(product => product.navDate).filter((value): value is string => Boolean(value))
      .map(value => {
        const [day, month, year] = value.split("/");
        return { display: value, iso: `${year}-${month}-${day}` };
      }).sort((a, b) => a.iso.localeCompare(b.iso));
    const complete = sourceTotal !== null && productCount === sourceTotal && failedPageCount === 0 && pageLinks.length < 20;
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
      completeness: complete ? "complete" : "partial",
      audit: {
        officialProductTotal: sourceTotal,
        uniqueIsinCount: productCount,
        parsedListingCount: rawRows.length,
        uniqueListingCount: products.length,
        duplicateListingRows: rawRows.length - products.length,
        discoveredAdditionalPages: pageLinks.length,
        fetchedPages: pages.length,
        failedPages: failedPageCount,
        missingNavCount: navMissingCount,
        navWithoutPublicationDateCount: navWithoutDateCount,
        oldestNavDate: navDates[0]?.display ?? null,
        newestNavDate: navDates.at(-1)?.display ?? null,
        completenessRule: "Complete only when the official total equals the distinct ISIN count and every discovered page was fetched."
      },
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
      if (url.pathname === "/api/market/euronext") return getEuronextTrades(request);
      return json({ status: "not_found", path: url.pathname }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
