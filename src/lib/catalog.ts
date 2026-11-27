export type AmundiCatalogProduct = {
  ticker: string; wkn: string; name: string; isin: string; currency: string;
  ongoingCharges: string | null; assetsUnderManagement: string | null; sfdr: string | null;
  exposure: string | null; nav: string | null; navDate: string | null;
  performanceYtd: string | null; performance1y: string | null; sourceUrl: string;
};
export type AmundiCatalogResponse = {
  status: "ok" | "source_unavailable" | "unparsed_source";
  source: string; retrievedAt?: string; sourceTotal?: number | null; productCount?: number;
  listingCount?: number; returnedCount?: number; pageCount?: number;
  completeness?: "complete" | "partial";
  audit?: {
    officialProductTotal: number | null;
    uniqueIsinCount: number;
    parsedListingCount: number;
    uniqueListingCount: number;
    duplicateListingRows: number;
    discoveredAdditionalPages: number;
    fetchedPages: number;
    failedPages: number;
    missingNavCount: number;
    navWithoutPublicationDateCount: number;
    oldestNavDate: string | null;
    newestNavDate: string | null;
    completenessRule: string;
  };
  notice?: string;
  products: AmundiCatalogProduct[];
};
