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
  const search = (new URL(request.url).searchParams.get("q") || "").trim().toLocaleLowerCase("fr-FR");
  const apiUrl = new URL("/mapi/ProductAPI/getProductsData", AMUNDI_SOURCE).toString();
  const context = {
    countryName: "France",
    countryCode: "FRA",
    languageName: "French",
    languageCode: "fr",
    userProfileName: "INSTIT",
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
    .map(period => ({ indicator: "PERFORMANCE", period }));
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
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return String(value);
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
      const productMetrics = product.metrics ?? [];
      const performance = (period: string) => {
        const value = productMetrics.find(item => item.indicator === "PERFORMANCE" && item.period === period)?.value;
        return asNumberText(value);
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
        excludedByFranceInstitutionalVisibility: activeProducts.length - visibleProducts.length,
        visibleProductRecords: visibleProducts.length,
        uniqueVisibleIsinCount: uniqueProducts.length,
        missingNavCount: uniqueProducts.filter(product => !product.nav).length,
        navWithoutPublicationDateCount: uniqueProducts.filter(product => Boolean(product.nav) && !product.navDate).length,
        missingIsinCount,
        duplicateIsinCount,
        country: context.countryName,
        countryCode: context.countryCode,
        profile: context.userProfileName,
        completenessRule: "Catalogue complet si tous les produits actifs visibles pour le contexte France/INSTIT ont un ISIN valide et qu'aucun ISIN n'est dupliqué."
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
        return json({ status: "ok", service: "investpilot-api", version: "0.5.2", timestamp: new Date().toISOString() });
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
