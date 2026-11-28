export type AmundiCatalogProduct = {
  ticker: string; wkn: string; name: string; isin: string; currency: string;
  ongoingCharges: string | null; assetsUnderManagement: string | null; sfdr: string | null;
  exposure: string | null; nav: string | null; navDate: string | null;
  performanceYtd: string | null; performance1y: string | null; sourceUrl: string;
  performance3y?: string | null; performance5y?: string | null; performance10y?: string | null;
  srri?: string | null;
  sourceType?: "amundi" | "manual";
  manualSource?: string | null;
  manualAddedAt?: string | null;
};

export type AmundiCatalogResponse = {
  status: "ok" | "source_unavailable" | "unparsed_source";
  source: string; retrievedAt?: string; sourceTotal?: number | null; productCount?: number;
  listingCount?: number; returnedCount?: number; pageCount?: number;
  completeness?: "complete" | "partial";
  audit?: {
    apiProductRecords: number;
    activeProductRecords: number;
    excludedByFranceInstitutionalVisibility: number;
    visibleProductRecords: number;
    uniqueVisibleIsinCount: number;
    missingIsinCount: number;
    duplicateIsinCount: number;
    missingNavCount: number;
    navWithoutPublicationDateCount: number;
    country: string;
    countryCode: string;
    profile: string;
    completenessRule: string;
  };
  notice?: string;
  products: AmundiCatalogProduct[];
};

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
}

export function matchesAmundiSearch(product: AmundiCatalogProduct, query: string): boolean {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const searchable = normalizeSearchText([
    product.name, product.isin, product.ticker, product.wkn, product.exposure,
    product.currency, product.sfdr
  ].filter(Boolean).join(" "));
  return tokens.every(token => searchable.includes(token));
}

export type AmundiCatalogFilters = {
  currency: string;
  venue: string;
  sfdr: string;
  exposure: string;
};

export function matchesAmundiFilters(
  product: AmundiCatalogProduct,
  filters: AmundiCatalogFilters,
  venue: string
): boolean {
  return (filters.currency === "Toutes" || product.currency === filters.currency)
    && (filters.venue === "Toutes" || venue === filters.venue)
    && (filters.sfdr === "Toutes" || product.sfdr === filters.sfdr)
    && (filters.exposure === "Toutes" || product.exposure === filters.exposure);
}
