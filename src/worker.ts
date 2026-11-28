import { buildAmundiPageUrls, countUniqueAmundiProducts, discoverAmundiPaginationLinks, extractAmundiTotal, parseAmundiRows } from "./lib/amundi-parser";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const AMUNDI_SOURCE = "https://www.amundietf.fr/fr/professionnels/produits-etf/recherche";
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
  if (requested.length > 1000) return json({ status: "invalid_request", message: "1000 ISIN maximum par requête." }, 400);
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
  const headers = {
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "Mozilla/5.0 (compatible; InvestPilot/0.5; +catalogue source attribution)",
    Referer: AMUNDI_SOURCE
  };
  try {
    const firstResponse = await fetch(AMUNDI_SOURCE, { headers });
    if (!firstResponse.ok) {
      return json({ status: "source_unavailable", source: AMUNDI_SOURCE, upstreamStatus: firstResponse.status, products: [] }, 502);
    }

    const firstPage = await firstResponse.text();
    const apiUrl = new URL("/mapi/ProductAPI/getProductsData", AMUNDI_SOURCE).toString();
    const apiCharacteristics = [
      "ISIN", "TICKER", "TER", "IS_CLIMATE", "SHARE_MARKETING_NAME", "CURRENCY", "AUM", "WKN",
      "MNEMO", "INDEX_TICKER", "EXCHANGE_PLACE", "INCEPTION_DATE", "AUM_IN_EURO", "FUND_AUM_IN_EURO",
      "NAV", "NAV_DATE_DISPLAYED", "FUND_TYPE", "FUND_REPLICATION_METHODOLOGY", "FUND_SFDR_CLASSIFICATION",
      "FUND_ISR_LABEL", "STRATEGY", "SUBASSET_CLASS", "ASSET_CLASS", "ESG_SCOPE", "ESG_SCOPES",
      "INVESTMENT_ZONE", "IMPACT", "CATEGORY", "DISTRIBUTION_POLICY", "CURRENCY_HEDGE", "FUND_PEA",
      "MAIN_LISTING", "CORE", "IS_ESG", "FUND_ISSUER", "IS_THEMATIC", "MAIN_LISTINGS", "ETF_CLASSIFICATION2",
      "IS_CORE", "LEVERAGE", "OLD_ISINS", "OLD_WKNS", "OLD_SHARE_MARKETING_NAMES", "INSURANCE_CONTRACTS_COUNT",
      "INSURANCE_PAGE_URL", "FUND_DOMICILIATION_COUNTRY", "SRRI", "LISTING_PLACES", "DESCRIPTIF",
      "IS_BEING_ABSORBED", "IS_BEING_ABSORBED_BY", "MARKET", "SHARE_TYPE", "IS_ACTIVELY_MANAGED",
      "SHARE_CLASS_TYPE", "VISIBILITY_EXCEPTIONS"
    ];
    const apiMetrics = ["ONE_YEAR", "THREE_YEARS", "FIVE_YEARS", "YEAR_TO_DATE", "TEN_YEARS"]
      .map(period => ({ indicator: "PERFORMANCE", period }));
    const apiProbes = await Promise.all(["INSTIT", "RETAIL"].map(async userProfileName => {
      const context = {
        countryName: "France", countryCode: "FRA", languageName: "French",
        languageCode: "fr", userProfileName, bcp47Code: "fr-FR"
      };
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: new URL(AMUNDI_SOURCE).origin,
            Referer: AMUNDI_SOURCE,
            "User-Agent": headers["User-Agent"]
          },
          body: JSON.stringify({
            sortCriterias: [], characteristics: apiCharacteristics, metrics: apiMetrics,
            context, productType: "ALL", historics: [], url: true, filters: []
          })
        });
        const raw = await response.text();
        let data: any = null;
        try { data = JSON.parse(raw); } catch { /* retain a short response sample */ }
        return {
          userProfileName, status: response.status, responseLength: raw.length,
          responseKeys: data && typeof data === "object" ? Object.keys(data) : [],
          productCount: Array.isArray(data?.products) ? data.products.length : null,
          productTypeCounts: Array.isArray(data?.products) ? data.products.reduce((counts: Record<string, number>, product: any) => {
            const type = String(product.productType ?? "UNKNOWN");
            counts[type] = (counts[type] ?? 0) + 1;
            return counts;
          }, {}) : {},
          productKeys: data?.products?.[0] ? Object.keys(data.products[0]) : [],
          characteristicKeys: data?.products?.[0]?.characteristics ? Object.keys(data.products[0].characteristics) : [],
          sampleProduct: data?.products?.find((product: any) => product.productType === "PRODUCT") ? {
            productId: data.products.find((product: any) => product.productType === "PRODUCT").productId,
            productType: data.products.find((product: any) => product.productType === "PRODUCT").productType,
            characteristics: data.products.find((product: any) => product.productType === "PRODUCT").characteristics,
            currencies: data.products.find((product: any) => product.productType === "PRODUCT").currencies,
            metrics: data.products.find((product: any) => product.productType === "PRODUCT").metrics
          } : null,
          sample: data ? null : raw.slice(0, 500)
        };
      } catch (error) {
        return { userProfileName, error: error instanceof Error ? error.message : "API request failed" };
      }
    }));
    const widgetScriptMatch = firstPage.match(/<script\b[^>]*src=["']([^"']*\/etf-finder\/[^"']*\.js[^"']*)["']/i);
    const widgetScriptUrl = widgetScriptMatch?.[1] ? new URL(widgetScriptMatch[1], AMUNDI_SOURCE).toString() : null;
    let widgetScriptText = "";
    let widgetScriptStatus: number | null = null;
    if (widgetScriptUrl) {
      try {
        const widgetResponse = await fetch(widgetScriptUrl, { headers });
        widgetScriptStatus = widgetResponse.status;
        if (widgetResponse.ok) widgetScriptText = await widgetResponse.text();
      } catch { /* diagnostic only; the catalogue remains source-controlled */ }
    }
    const widgetApiStrings = [...new Set(widgetScriptText.match(/["'`](?:https?:\/\/|\/)[^"'`]{3,180}["'`]/g) ?? [])]
      .filter(value => /api|search|product|finder|etf|data/i.test(value)).slice(0, 40);
    const widgetFunctionHints = [...widgetScriptText.matchAll(/.{0,100}(?:fetch\(|XMLHttpRequest|axios|apiUrl|baseUrl|pageSize|pageNum|totalItems|searchEndpoint).{0,100}/gi)]
      .slice(0, 30).map(match => match[0].replace(/\s+/g, " ").trim().slice(0, 220));
    const widgetTerms = ["getProductsData", "ProductAPI", "ETF_FINDER", "productsSize", "finderAPIResponse", "getProductsData(", "getProductsData:", "getProductsData=", "initFinder", "searchProducts", "domainMap"];
    const widgetCallSites = ["getContextFromLocalStorage(){", "getContextFromLocalStorage()", "localStorage.setItem", "countryName:", "userProfileName:", "userProfileSlug:", "let At=", "const At=", "At=(()=>", "getProductsData"].flatMap(term => {
      const indexes: number[] = [];
      let from = 0;
      while (indexes.length < 120) {
        const index = widgetScriptText.indexOf(term, from);
        if (index < 0) break;
        indexes.push(index);
        from = index + term.length;
      }
      return indexes.slice(-6).map(index => ({
        term,
        index,
        snippet: widgetScriptText.slice(Math.max(0, index - 1200), Math.min(widgetScriptText.length, index + 2800))
      }));
    });
    const finderWidgetMarkup = [...firstPage.matchAll(/<[^>]*(?:etf-finder|finder-widget)[^>]*>/gi)].slice(0, 10).map(match => match[0].slice(0, 3000));
    const widgetTermSnippets = widgetTerms.map(term => {
      const index = widgetScriptText.indexOf(term);
      return index < 0 ? null : { term, snippet: widgetScriptText.slice(Math.max(0, index - 220), index + 520) };
    }).filter((value): value is { term: string; snippet: string } => value !== null);
    const sourceTotal = extractAmundiTotal(firstPage);
    // Amundi renders 50 products on the initial page; its pager is JavaScript,
    // so the remaining numbered pages must also be requested explicitly.
    const pageUrls = [...new Set([
      ...discoverAmundiPaginationLinks(firstPage, AMUNDI_SOURCE),
      ...buildAmundiPageUrls(AMUNDI_SOURCE, sourceTotal, 50)
    ])].filter(url => {
      try {
        const parsed = new URL(url);
        return parsed.origin === new URL(AMUNDI_SOURCE).origin && parsed.pathname === new URL(AMUNDI_SOURCE).pathname;
      } catch { return false; }
    });

    const pageResults = await Promise.all(pageUrls.map(async url => {
      try {
        const response = await fetch(url, { headers });
        return response.ok
          ? { url, html: await response.text(), failed: false }
          : { url, html: "", failed: true };
      } catch {
        return { url, html: "", failed: true };
      }
    }));

    const htmlPages = [firstPage];
    let failedPages = pageResults.filter(page => page.failed).length;
    const seenPageBodies = new Set([firstPage]);
    for (const page of pageResults) {
      if (page.failed || !page.html) continue;
      // Some CDN responses ignore ?page=. Never count a repeated first page
      // as a successful fetch of a different catalogue batch.
      if (seenPageBodies.has(page.html)) {
        failedPages += 1;
        continue;
      }
      seenPageBodies.add(page.html);
      htmlPages.push(page.html);
    }

    const rawRows = htmlPages.flatMap(html => parseAmundiRows(html, AMUNDI_SOURCE));
    const products = [...new Map(rawRows.map(row => [row.isin + "|" + row.ticker, row])).values()];
    const productCount = countUniqueAmundiProducts(products);
    const navMissingCount = products.filter(product => !product.nav).length;
    const navWithoutDateCount = products.filter(product => Boolean(product.nav) && !product.navDate).length;
    const navDates = products.map(product => product.navDate).filter((value): value is string => Boolean(value))
      .map(value => {
        const [day, month, year] = value.split("/");
        return { display: value, iso: `${year}-${month}-${day}` };
      }).sort((a, b) => a.iso.localeCompare(b.iso));
    const expectedPages = sourceTotal === null ? null : Math.ceil(sourceTotal / 50);
    const allExpectedPagesFetched = expectedPages !== null && htmlPages.length === expectedPages;
    const complete = sourceTotal !== null && productCount === sourceTotal && failedPages === 0 && allExpectedPagesFetched;
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
      pageCount: htmlPages.length,
      completeness: complete ? "complete" : "partial",
      audit: {
        apiUrl,
        apiProbes,
        widgetScriptUrl,
        widgetScriptStatus,
        widgetScriptLength: widgetScriptText.length,
        widgetApiStrings,
        widgetTermSnippets,
        widgetCallSites,
        finderWidgetMarkup,
        widgetFunctionHints,
        sourceHtmlLength: firstPage.length,
        sourceScriptUrls: [...firstPage.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)]
          .map(match => match[1]).slice(0, 30),
        sourceApiHints: [...firstPage.matchAll(/.{0,90}(?:api|ajax|json|graphql|pageSize|pageNum|finder|search).{0,90}/gi)]
          .slice(0, 20).map(match => match[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)),
        sourceMarkerFound: firstPage.includes("ETF_FINDER_SUMMARY"),
        sourceHtmlTableRows: (firstPage.match(/<tr\b/gi) ?? []).length,
        sourceProductMentions: [...firstPage.matchAll(/.{0,100}(?:produit|trouv).{0,100}/gi)].slice(0, 8)
          .map(match => match[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)),
        sourceFirstTableRow: firstPage.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/i)?.[0].replace(/\s+/g, " ").slice(0, 1200) ?? null,
        officialProductTotal: sourceTotal,
        uniqueIsinCount: productCount,
        parsedListingCount: rawRows.length,
        uniqueListingCount: products.length,
        duplicateListingRows: rawRows.length - products.length,
        discoveredAdditionalPages: pageUrls.length,
        fetchedPages: htmlPages.length,
        failedPages,
        missingNavCount: navMissingCount,
        navWithoutPublicationDateCount: navWithoutDateCount,
        oldestNavDate: navDates[0]?.display ?? null,
        newestNavDate: navDates.at(-1)?.display ?? null,
        completenessRule: "Complet uniquement si tous les lots attendus sont récupérés, sans page en échec, et si le nombre d'ISIN distincts égale le total officiel Amundi."
      },
      notice: "Les valeurs liquidatives Amundi sont des valeurs publiées par l'émetteur, pas des cours de marché en temps réel. Les cours de marché sont fournis séparément lorsqu'une source de cotation les publie.",
      products: filtered
    }, 200, { "Cache-Control": "public, max-age=300, s-maxage=900" });
  } catch {
    return json({ status: "source_unavailable", source: AMUNDI_SOURCE, products: [] }, 502);
  }
}

const INSURANCE_FEES_CSV = "https://www.data.gouv.fr/api/1/datasets/r/3a1608bf-25e2-421f-bbd5-e46ae42256ab";
const INSURANCE_EURO_CSV = "https://www.data.gouv.fr/api/1/datasets/r/d6c8853b-b38e-4aa3-a119-4cb7935429a6";

function parseCsvDocument(input: string): Record<string, string>[] {
  const source = input.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (() => {
    const counts = [",", ";", "\t"].map(separator => {
      let quoted = false, count = 0;
      for (let i = 0; i < firstLine.length; i++) {
        if (firstLine[i] === '"') quoted = !quoted;
        else if (firstLine[i] === separator && !quoted) count++;
      }
      return count;
    });
    return [",", ";", "\t"][counts.indexOf(Math.max(...counts))];
  })();
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(value => value.length)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV assurance-vie vide ou non reconnu");
  const headers = rows[0].map(value => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (!headers.includes("slug") || !headers.includes("contrat")) throw new Error("En-têtes CSV assurance-vie non reconnus");
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function nullableNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const compact = value.trim().replace(/\s/g, "").replace(/%$/, "");
  const normalized = compact.includes(",") && !compact.includes(".")
    ? (/,\d{3}$/.test(compact) ? compact.replace(/,/g, "") : compact.replace(",", "."))
    : compact.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function assuranceVieType(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  return normalized === "av" || normalized.includes("assurancevie");
}

async function getAssuranceVieContracts(): Promise<Response> {
  const retrievedAt = new Date().toISOString();
  try {
    const [feesResponse, euroResponse] = await Promise.all([
      fetch(INSURANCE_FEES_CSV, { headers: { Accept: "text/csv,*/*" } }),
      fetch(INSURANCE_EURO_CSV, { headers: { Accept: "text/csv,*/*" } })
    ]);
    if (!feesResponse.ok || !euroResponse.ok) {
      return json({ status: "source_unavailable", retrievedAt, message: "Un des jeux de données publics assurance-vie est indisponible. Aucune donnée partielle n'est affichée." }, 502);
    }
    const [feeRows, euroRows] = await Promise.all([
      feesResponse.text().then(parseCsvDocument),
      euroResponse.text().then(parseCsvDocument)
    ]);
    const euroBySlug = new Map(euroRows.filter(row => row.slug && assuranceVieType(row.type ?? "")).map(row => [row.slug, row] as const));
    const contracts = feeRows.filter(row => row.slug && assuranceVieType(row.type ?? "")).map(row => {
      const euro = euroBySlug.get(row.slug) ?? {};
      return {
        slug: row.slug,
        name: row.contrat || euro.contrat || row.slug,
        insurer: row.assureur || euro.assureur || null,
        distributor: row.courtier || euro.courtier || null,
        management: row.gestion || euro.gestion || null,
        entryFeePct: nullableNumber(row.frais_versement_pct),
        ucManagementFeePct: nullableNumber(row.frais_gestion_uc_pct),
        euroManagementFeePct: nullableNumber(row.frais_gestion_fonds_euros_pct),
        arbitrationFeePct: nullableNumber(row.frais_arbitrage_pct),
        supportCount: nullableNumber(row.nombre_supports),
        etfCount: nullableNumber(row.nombre_etf),
        scpiCount: nullableNumber(row.nombre_scpi),
        minimumInitialEur: nullableNumber(row.versement_initial_min_eur),
        euroFund: euro.fonds_euros || null,
        euroRate2025Pct: nullableNumber(euro.taux_2025_pct),
        euroRate2024Pct: nullableNumber(euro.taux_2024_pct),
        euroRate2023Pct: nullableNumber(euro.taux_2023_pct),
        feeCheckedAt: row.date_releve || null,
        rateCheckedAt: euro.date_releve || null,
        contractSourceUrl: row.url_source_principale || null,
        rateSourceUrl: euro.url_source_principale || null,
        detailUrl: row.url_fiche_savoirplacer || euro.url_fiche_savoirplacer || null
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (!contracts.length) throw new Error("Aucun contrat d'assurance-vie reconnu dans les fichiers sources");
    return json({
      status: "ok",
      sourceName: "Savoir Placer · jeux de données ouverts publiés sur data.gouv.fr",
      retrievedAt,
      sourceLicense: "Licence Ouverte / Open Licence 2.0",
      sourceUrls: {
        fees: "https://www.data.gouv.fr/datasets/frais-des-contrats-dassurance-vie-et-per-contrat-par-contrat",
        euroRates: "https://www.data.gouv.fr/datasets/taux-des-fonds-euros-des-contrats-dassurance-vie-et-per"
      },
      methodology: "Comparaison descriptive, sans note ni classement. Frais et taux proviennent de deux fichiers distincts et sont rapprochés par slug. Les cases vides restent nulles et ne sont jamais transformées en zéro.",
      rateDefinition: "Taux du fonds euros nets des frais de gestion du contrat et bruts des prélèvements sociaux ; bonus conditionnels non inclus.",
      contractCount: contracts.length,
      contracts
    }, 200, { "Cache-Control": "public, max-age=300, s-maxage=900" });
  } catch (error) {
    return json({
      status: "source_unavailable",
      retrievedAt,
      message: error instanceof Error ? error.message : "Erreur de lecture des jeux de données assurance-vie."
    }, 502);
  }
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return json({ status: "method_not_allowed" }, 405, { Allow: "GET" });
      if (url.pathname === "/api/health") {
        return json({ status: "ok", service: "investpilot-api", version: "0.5.0", timestamp: new Date().toISOString() });
      }
      if (url.pathname === "/api/catalog/amundi") return getAmundiCatalog(request);
      if (url.pathname === "/api/market/fx") return getEcbFx();
      if (url.pathname === "/api/assurance-vie/contracts") return getAssuranceVieContracts();
      if (url.pathname === "/api/market/euronext") return getEuronextTrades(request);
      return json({ status: "not_found", path: url.pathname }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
