interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; }
interface D1Database { prepare(query: string): D1PreparedStatement; batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>; }
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HISTORY_DB: D1Database;
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
  const search = (new URL(request.url).searchParams.get("q") || "").trim().toLocaleLowerCase("fr-FR");
  const apiUrl = new URL("/mapi/ProductAPI/getProductsData", AMUNDI_SOURCE).toString();
  const context = {
    countryName: "France",
    countryCode: "FRA",
    languageName: "French",
    languageCode: "fr",
    userProfileName: "RETAIL",
    bcp47Code: "fr-FR"
  };
  const characteristics = [
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
  const metrics = ["ONE_YEAR", "THREE_YEARS", "FIVE_YEARS", "YEAR_TO_DATE", "TEN_YEARS"]
    .map(period => ({ indicator: "shareCumulativePerformance", period }));
  const retrievedAt = new Date().toISOString();
  const sourceHeaders = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: new URL(AMUNDI_SOURCE).origin,
    Referer: AMUNDI_SOURCE,
    "User-Agent": "Mozilla/5.0 (compatible; InvestPilot/0.5; +catalogue source attribution)"
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: sourceHeaders,
      body: JSON.stringify({
        sortCriterias: [],
        characteristics,
        metrics,
        context,
        productType: "ALL",
        historics: [],
        url: true,
        filters: []
      })
    });
    if (!response.ok) {
      return json({
        status: "source_unavailable",
        source: AMUNDI_SOURCE,
        apiSource: apiUrl,
        retrievedAt,
        upstreamStatus: response.status,
        products: [],
        message: "L'API officielle Amundi est indisponible. Aucun ancien catalogue ni chiffre de remplacement n'est affiché."
      }, 502);
    }

    const payload = await response.json() as {
      products?: Array<{
        productId?: string;
        productType?: string;
        characteristics?: Record<string, unknown>;
        metrics?: Array<{ indicator?: string; period?: string; value?: unknown }>;
      }>;
    };
    if (!Array.isArray(payload.products)) {
      return json({
        status: "unparsed_source", source: AMUNDI_SOURCE, apiSource: apiUrl,
        retrievedAt, products: [],
        message: "Le format de réponse de l'API Amundi a changé. Aucune donnée n'a été importée."
      }, 502);
    }

    const allProducts = payload.products;
    const activeProducts = allProducts.filter(product => product.productType === "PRODUCT");
    const visibleProducts = activeProducts.filter(product => {
      const exceptions = product.characteristics?.VISIBILITY_EXCEPTIONS;
      if (!Array.isArray(exceptions)) return true;
      return !exceptions.some((exception: unknown) => {
        if (!exception || typeof exception !== "object") return false;
        const item = exception as { countryCode?: unknown; userProfileName?: unknown };
        return String(item.countryCode ?? "").toUpperCase() === context.countryCode
          && String(item.userProfileName ?? "").toUpperCase() === context.userProfileName;
      });
    });

    const asText = (value: unknown): string => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    };
    const asNumberText = (value: unknown): string | null => {
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
      if (typeof value === "string") {
        const cleaned = value.trim().replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
        if (!cleaned) return null;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? String(parsed) : null;
      }
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        for (const key of ["value", "amount", "number", "numericValue", "rawValue", "displayValue", "formattedValue"]) {
          if (record[key] !== undefined && record[key] !== value) {
            const parsed = asNumberText(record[key]);
            if (parsed !== null) return parsed;
          }
        }
      }
      return null;
    };
    const formatDate = (value: unknown): string | null => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return null;
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric"
      }).format(date);
    };

    const mapped = visibleProducts.flatMap(product => {
      const data = product.characteristics ?? {};
      const isin = asText(data.ISIN).toUpperCase();
      const name = asText(data.SHARE_MARKETING_NAME);
      if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin) || !name) return [];
      const listings = data.MAIN_LISTINGS && typeof data.MAIN_LISTINGS === "object"
        ? data.MAIN_LISTINGS as Record<string, unknown> : {};
      const ticker = asText(listings[context.countryCode])
        || asText(listings.DEU)
        || asText(Object.values(listings)[0])
        || asText(data.MNEMO);
      const productMetrics = Array.isArray(product.metrics) ? product.metrics : [];
      const performance = (period: string) => {
        const aliases: Record<string, string[]> = {
          YEAR_TO_DATE: ["YEAR_TO_DATE", "YTD", "YTD_PERFORMANCE"],
          ONE_YEAR: ["ONE_YEAR", "1_YEAR", "1Y", "ONE_YEAR_PERFORMANCE"],
          THREE_YEARS: ["THREE_YEARS", "3_YEARS", "3Y", "THREE_YEARS_PERFORMANCE"],
          FIVE_YEARS: ["FIVE_YEARS", "5_YEARS", "5Y", "FIVE_YEARS_PERFORMANCE"],
          TEN_YEARS: ["TEN_YEARS", "10_YEARS", "10Y", "TEN_YEARS_PERFORMANCE"]
        };
        const acceptedPeriods = aliases[period] ?? [period];
        const metric = productMetrics.find(item =>
          ["SHARECUMULATIVEPERFORMANCE", "PERFORMANCE"].includes(String(item.indicator ?? "").toUpperCase())
          && acceptedPeriods.includes(String(item.period ?? "").toUpperCase())
        ) as Record<string, unknown> | undefined;
        const metricValue = metric?.value ?? metric?.values ?? metric?.performance ?? metric?.result;
        const directValue = asNumberText(metricValue);
        if (directValue !== null) {
          const alreadyPercent = typeof metricValue === "string" && metricValue.includes("%");
          return alreadyPercent ? directValue : String(Number(directValue) * 100);
        }
        const characteristicKeys = [
          `PERFORMANCE_${period}`, `PERF_${period}`, period,
          ...acceptedPeriods.map(alias => `PERFORMANCE_${alias}`)
        ];
        for (const key of characteristicKeys) {
          const parsed = asNumberText(data[key]);
          if (parsed !== null) return String(Number(parsed) * 100);
        }
        return null;
      };
      const exposure = asText(data.INVESTMENT_ZONE)
        || asText(data.ETF_CLASSIFICATION2)
        || asText(data.ASSET_CLASS)
        || asText(data.SUBASSET_CLASS)
        || asText(data.MARKET)
        || asText(data.DESCRIPTIF);
      const ter = asNumberText(data.TER);
      return [{
        ticker,
        wkn: asText(data.WKN),
        name,
        isin,
        currency: asText(data.CURRENCY) || asText((product as any).currencies?.CURRENCY) || "",
        ongoingCharges: ter === null ? null : `${ter} %`,
        assetsUnderManagement: asNumberText(data.FUND_AUM_IN_EURO)
          ?? asNumberText(data.AUM_IN_EURO)
          ?? asNumberText(data.AUM),
        sfdr: asText(data.FUND_SFDR_CLASSIFICATION) || null,
        exposure: exposure || null,
        nav: asNumberText(data.NAV),
        navDate: formatDate(data.NAV_DATE_DISPLAYED),
        performanceYtd: performance("YEAR_TO_DATE"),
        performance1y: performance("ONE_YEAR"),
        performance3y: performance("THREE_YEARS"),
        performance5y: performance("FIVE_YEARS"),
        performance10y: performance("TEN_YEARS"),
        // Amundi publishes the SRRI on the product characteristics. Keep only
        // the official 1–7 scale; missing or malformed values remain unavailable.
        srri: /^[1-7]$/.test(asText(data.SRRI)) ? asText(data.SRRI) : null,
        sourceUrl: AMUNDI_SOURCE,
        sourceType: "amundi" as const
      }];
    });

    // One product may expose several listings; the application compares funds by ISIN.
    const uniqueProducts = [...new Map(mapped.map(product => [product.isin, product])).values()];
    const missingIsinCount = visibleProducts.filter(product => {
      const isin = asText(product.characteristics?.ISIN).toUpperCase();
      return !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin);
    }).length;
    const duplicateIsinCount = mapped.length - uniqueProducts.length;
    const complete = uniqueProducts.length > 500
      && missingIsinCount === 0
      && duplicateIsinCount === 0
      && uniqueProducts.every(product => Boolean(product.isin && product.name));
    const filtered = search
      ? uniqueProducts.filter(product => [
          product.name, product.isin, product.ticker, product.wkn, product.exposure,
          product.currency, product.sfdr
        ].some(value => (value ?? "").toLocaleLowerCase("fr-FR").includes(search)))
      : uniqueProducts;

    return json({
      status: complete ? "ok" : "unparsed_source",
      source: AMUNDI_SOURCE,
      apiSource: apiUrl,
      retrievedAt,
      sourceTotal: uniqueProducts.length,
      productCount: uniqueProducts.length,
      listingCount: mapped.length,
      returnedCount: filtered.length,
      pageCount: 1,
      completeness: complete ? "complete" : "partial",
      audit: {
        apiProductRecords: allProducts.length,
        activeProductRecords: activeProducts.length,
        excludedByFranceRetailVisibility: activeProducts.length - visibleProducts.length,
        visibleProductRecords: visibleProducts.length,
        uniqueVisibleIsinCount: uniqueProducts.length,
        missingNavCount: uniqueProducts.filter(product => !product.nav).length,
        navWithoutPublicationDateCount: uniqueProducts.filter(product => Boolean(product.nav) && !product.navDate).length,
        performanceCoverage: {
          ytd: uniqueProducts.filter(product => product.performanceYtd !== null).length,
          oneYear: uniqueProducts.filter(product => product.performance1y !== null).length,
          threeYears: uniqueProducts.filter(product => product.performance3y !== null).length,
          fiveYears: uniqueProducts.filter(product => product.performance5y !== null).length,
          tenYears: uniqueProducts.filter(product => product.performance10y !== null).length
        },
        missingIsinCount,
        duplicateIsinCount,
        country: context.countryName,
        countryCode: context.countryCode,
        profile: context.userProfileName,
        completenessRule: "Catalogue complet si tous les produits actifs visibles pour le contexte France/RETAIL ont un ISIN valide et qu'aucun ISIN n'est dupliqué."
      },
      notice: "Données issues de l'API officielle Amundi. Les valeurs liquidatives et performances sont celles publiées par l'émetteur, avec leur date propre ; elles ne constituent pas des cours de marché en temps réel.",
      products: filtered
    }, 200, { "Cache-Control": "public, max-age=300, s-maxage=900" });
  } catch (error) {
    return json({
      status: "source_unavailable",
      source: AMUNDI_SOURCE,
      apiSource: apiUrl,
      retrievedAt,
      products: [],
      message: error instanceof Error ? error.message : "Erreur de lecture de l'API officielle Amundi."
    }, 502);
  }
}



const YAHOO_EXCHANGE_SUFFIXES: Record<string, string> = {
  FP: ".PA", NA: ".AS", BB: ".BR", IM: ".MI", GY: ".DE",
  LN: ".L", SW: ".SW", SM: ".MC", GR: ".F", SS: ".ST"
};

function yahooSymbolFromTicker(ticker: string): string | null {
  const parts = ticker.trim().toUpperCase().split(/\s+/);
  if (parts.length < 2) return null;
  const suffix = parts[parts.length - 1];
  const exchangeSuffix = YAHOO_EXCHANGE_SUFFIXES[suffix];
  const base = parts.slice(0, -1).join(".");
  if (!exchangeSuffix || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(base)) return null;
  return base + exchangeSuffix;
}

async function getEtfHistory(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const isin = (url.searchParams.get("isin") ?? "").trim().toUpperCase();
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return json({ status: "invalid_request", message: "ISIN invalide." }, 400);
  }
  const symbol = yahooSymbolFromTicker(ticker);
  if (!symbol) {
    return json({ status: "unsupported_listing", message: "Ticker non reconnu par la correspondance des places de cotation Yahoo Finance. Aucun historique de remplacement n'est affiché." }, 200);
  }
  const sourceUrl = "https://finance.yahoo.com/quote/" + encodeURIComponent(symbol) + "/history/";
  const apiUrl = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  apiUrl.searchParams.set("range", "10y");
  apiUrl.searchParams.set("interval", "1d");
  apiUrl.searchParams.set("events", "div,splits");
  const retrievedAt = new Date().toISOString();
  try {
    const response = await fetch(apiUrl.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; InvestPilot/0.6)"
      }
    });
    if (!response.ok) return json({
      status: "source_unavailable", source: sourceUrl, retrievedAt, points: [],
      upstreamStatus: response.status,
      message: "Yahoo Finance ne fournit pas l'historique de cette cotation pour le moment. Aucun cours n'est inventé."
    }, 502);
    const payload = await response.json() as {
      chart?: {
        error?: { code?: string; description?: string } | null;
        result?: Array<{
          meta?: { currency?: string; exchangeName?: string; symbol?: string };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[]; close?: (number|null)[]; volume?: (number|null)[] }>;
            adjclose?: Array<{ adjclose?: (number|null)[] }>;
          };
        }> | null;
      };
    };
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps = result?.timestamp ?? [];
    const adjustedValues = result?.indicators?.adjclose?.[0]?.adjclose;
    const rawCloses = quote?.close ?? [];
    const adjusted = Array.isArray(adjustedValues) && adjustedValues.some(value => typeof value === "number" && Number.isFinite(value));
    const points = timestamps.flatMap((timestamp, index) => {
      const rawClose = rawCloses[index];
      const adjustedClose = adjustedValues?.[index];
      const close = adjusted && typeof adjustedClose === "number" && Number.isFinite(adjustedClose)
        ? adjustedClose
        : rawClose;
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return [];
      return [{
        date: new Date(timestamp * 1000).toISOString().slice(0,10),
        close,
        rawClose: typeof rawClose === "number" && Number.isFinite(rawClose) ? rawClose : null,
        open: quote?.open?.[index] ?? null,
        high: quote?.high?.[index] ?? null,
        low: quote?.low?.[index] ?? null,
        volume: quote?.volume?.[index] ?? null
      }];
    }).sort((a,b)=>a.date.localeCompare(b.date));
    if (!points.length) return json({
      status: "no_history", source: sourceUrl, retrievedAt, points: [],
      message: payload.chart?.error?.description || "Yahoo Finance n'a retourné aucun cours historique exploitable pour cette cotation."
    }, 200, { "Cache-Control": "public, max-age=3600, s-maxage=3600" });
    const yearEndByYear = new Map<number, (typeof points)[number]>();
    for (const point of points) yearEndByYear.set(Number(point.date.slice(0,4)), point);
    const annualReturns = [...yearEndByYear.keys()].sort((a,b)=>a-b).flatMap(year => {
      const previousYearEnd = yearEndByYear.get(year - 1);
      const currentYearEnd = yearEndByYear.get(year);
      if (!previousYearEnd || !currentYearEnd) return [];
      return [{
        year,
        returnPct: (currentYearEnd.close / previousYearEnd.close - 1) * 100,
        fromDate: previousYearEnd.date,
        toDate: currentYearEnd.date,
        period: year === new Date().getUTCFullYear() ? "year_to_date" : "calendar_year"
      }];
    });
    return json({
      status: "ok", source: sourceUrl, sourceName: "Yahoo Finance · historique quotidien",
      isin, ticker, symbol, currency: result?.meta?.currency ?? null,
      exchangeName: result?.meta?.exchangeName ?? null,
      adjusted, from: points[0].date, to: points[points.length-1].date,
      retrievedAt, points, annualReturns,
      methodology: adjusted
        ? "Cours de clôture ajustés retournés par Yahoo Finance, avec les événements de dividendes et de fractionnement demandés à la source. Historique disponible jusqu'à dix ans selon l'ancienneté de la cotation."
        : "Cours de clôture non ajustés retournés par Yahoo Finance : la série n'intègre pas les distributions. Historique disponible jusqu'à dix ans selon l'ancienneté de la cotation."
    }, 200, { "Cache-Control": "public, max-age=21600, s-maxage=21600" });
  } catch (error) {
    return json({ status: "source_unavailable", source: sourceUrl, retrievedAt, points: [],
      message: error instanceof Error ? error.message : "Erreur de lecture de l'historique Yahoo Finance." }, 502);
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

const INSURANCE_EURO_SOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/d6c8853b-b38e-4aa3-a119-4cb7935429a6";

async function persistAssuranceEuroRates(env: Env, rows: Record<string, string>[]): Promise<number> {
  const collectedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (!row.slug || !assuranceVieType(row.type ?? "")) continue;
    for (const [key, raw] of Object.entries(row)) {
      const match = /^taux_(\d{4})_pct$/.exec(key);
      if (!match) continue;
      const rate = nullableNumber(raw);
      if (rate === null || rate <= -100 || rate >= 1000) continue;
      const sql = "INSERT INTO assurance_euro_rates (contract_slug, fund_name, rate_year, rate_pct, source_url, source_checked_at, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(contract_slug, rate_year, source_url) DO UPDATE SET fund_name=excluded.fund_name, rate_pct=excluded.rate_pct, source_checked_at=excluded.source_checked_at, collected_at=excluded.collected_at";
      statements.push(env.HISTORY_DB.prepare(sql).bind(row.slug, row.fonds_euros || null, Number(match[1]), rate, row.url_source_principale || INSURANCE_EURO_SOURCE_URL, row.date_releve || null, collectedAt));
    }
  }
  for (let offset = 0; offset < statements.length; offset += 80) await env.HISTORY_DB.batch(statements.slice(offset, offset + 80));
  return statements.length;
}

async function getAssuranceVieHistory(request: Request, env: Env): Promise<Response> {
  const slug = (new URL(request.url).searchParams.get("slug") ?? "").trim();
  if (!slug || slug.length > 200) return json({ status: "invalid_request", message: "Fournir le slug du contrat." }, 400);
  try {
    const result = await env.HISTORY_DB.prepare("SELECT contract_slug AS slug, fund_name AS fundName, rate_year AS year, rate_pct AS ratePct, source_url AS sourceUrl, source_checked_at AS sourceCheckedAt, collected_at AS collectedAt FROM assurance_euro_rates WHERE contract_slug = ? ORDER BY rate_year").bind(slug).all();
    return json({ status: "ok", layer: "euro_fund", slug, count: result.results.length, observations: result.results, methodology: "Taux annuels publiés par année source. La date de collecte InvestPilot est distincte de l’année de rendement ; aucune observation quotidienne n’est créée." }, 200, { "Cache-Control": "public, max-age=300, s-maxage=600" });
  } catch (error) {
    return json({ status: "database_unavailable", message: error instanceof Error ? error.message : "Lecture D1 impossible." }, 503);
  }
}

async function getAssuranceVieContracts(env: Env): Promise<Response> {
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
    const historyStored = await persistAssuranceEuroRates(env, euroRows);
    const feeBySlug = new Map(feeRows.filter(row => row.slug && assuranceVieType(row.type ?? "")).map(row => [row.slug, row] as const));
    const euroBySlug = new Map(euroRows.filter(row => row.slug && assuranceVieType(row.type ?? "")).map(row => [row.slug, row] as const));
    const assuranceSlugs = [...new Set([...feeBySlug.keys(), ...euroBySlug.keys()])];
    const availableRateYears = Array.from({ length: 16 }, (_, index) => 2015 + index)
      .filter(year => year <= new Date().getUTCFullYear() - 1 && euroRows.some(row => nullableNumber(row[`taux_${year}_pct`]) !== null));
    const performanceEndYear = availableRateYears.length ? Math.max(...availableRateYears) : 2025;
    const buildEuroPerformance = (euro: Record<string, string>, years: number) => {
      const fromYear = performanceEndYear - years + 1;
      const annualRates = Array.from({ length: years }, (_, index) => nullableNumber(euro[`taux_${fromYear + index}_pct`]));
      const observations = annualRates.filter((rate): rate is number => rate !== null).length;
      if (observations !== years || annualRates.some(rate => rate === null || rate <= -100)) {
        return { annualizedPct: null, cumulativePct: null, years, fromYear, toYear: performanceEndYear, observations };
      }
      const growth = (annualRates as number[]).reduce((factor, rate) => factor * (1 + rate / 100), 1);
      return {
        annualizedPct: (Math.pow(growth, 1 / years) - 1) * 100,
        cumulativePct: (growth - 1) * 100,
        years, fromYear, toYear: performanceEndYear, observations
      };
    };
    const contracts = assuranceSlugs.map(slug => {
      const row: Record<string, string> = feeBySlug.get(slug) ?? {};
      const euro: Record<string, string> = euroBySlug.get(slug) ?? {};
      return {
        slug,
        name: row.contrat || euro.contrat || slug,
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
        annualRates: Array.from({ length: performanceEndYear - 2015 + 1 }, (_, index) => {
          const year = 2015 + index;
          return { year, ratePct: nullableNumber(euro["taux_" + year + "_pct"]) };
        }),
        euroPerformance: {
          "1": buildEuroPerformance(euro, 1),
          "3": buildEuroPerformance(euro, 3),
          "5": buildEuroPerformance(euro, 5),
          "8": buildEuroPerformance(euro, 8)
        },
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
      methodology: "Tous les contrats identifiés comme assurance-vie dans le fichier des frais sont conservés, sans filtre sur le nombre d'ETF ni sur le nombre de supports. Le classement porte uniquement sur le fonds euros : rendement annualisé composé (CAGR) et rendement cumulé calculés à partir des taux annuels publiés. Une période n'est classable que si toutes ses années sont renseignées ; les données manquantes restent nulles. Les performances des unités de compte et des gestions pilotées ne sont pas assimilées à celles du contrat.",
      performanceEndYear,
      rateDefinition: "Taux du fonds euros nets des frais de gestion du contrat et bruts des prélèvements sociaux ; bonus conditionnels non inclus.",
      contractCount: contracts.length,
      history: { layer: 'euro_fund', storedRows: historyStored, endpoint: '/api/assurance-vie/history?slug={contract_slug}' },
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
  async scheduled(_event: { cron?: string }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil((async () => {
      const response = await fetch(INSURANCE_EURO_CSV, { headers: { Accept: "text/csv,*/*" } });
      if (!response.ok) throw new Error("Source fonds euros indisponible: HTTP " + response.status);
      const rows = parseCsvDocument(await response.text());
      await persistAssuranceEuroRates(env, rows);
    })());
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return json({ status: "method_not_allowed" }, 405, { Allow: "GET" });
      if (url.pathname === "/api/health") {
        return json({ status: "ok", service: "investpilot-api", version: "0.6.1", timestamp: new Date().toISOString() });
      }
      if (url.pathname === "/api/catalog/amundi") return getAmundiCatalog(request);
      if (url.pathname === "/api/market/fx") return getEcbFx();
      if (url.pathname === "/api/assurance-vie/contracts") return getAssuranceVieContracts(env);
      if (url.pathname === "/api/assurance-vie/history") return getAssuranceVieHistory(request, env);
      if (url.pathname === "/api/market/euronext") return getEuronextTrades(request);
      if (url.pathname === "/api/market/history") return getEtfHistory(request);
      return json({ status: "not_found", path: url.pathname }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
