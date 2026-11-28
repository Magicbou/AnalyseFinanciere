import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

const apiUrl = "https://www.amundietf.fr/mapi/ProductAPI/getProductsData";

function apiProduct(index: number, overrides: Record<string, unknown> = {}) {
  const isin = `LU${String(index + 1).padStart(10, "0")}`;
  return {
    productId: isin,
    productType: "PRODUCT",
    characteristics: {
      ISIN: isin,
      SHARE_MARKETING_NAME: `Amundi Test ETF ${index + 1}`,
      MAIN_LISTINGS: { FRA: `ETF${index + 1} FP`, DEU: `ETF${index + 1} GY` },
      WKN: `WKN${index + 1}`,
      CURRENCY: "EUR",
      TER: 0.18,
      FUND_AUM_IN_EURO: 125000000,
      FUND_SFDR_CLASSIFICATION: "Article 8",
      ETF_CLASSIFICATION2: "MSCI World",
      SRRI: "4",
      NAV: 123.45,
      NAV_DATE_DISPLAYED: 1795651200000,
      VISIBILITY_EXCEPTIONS: [],
      ...overrides
    },
    metrics: [
      { indicator: "PERFORMANCE", period: "YEAR_TO_DATE", value: "7,5 %" },
      { indicator: "PERFORMANCE", period: "ONE_YEAR", value: "12,3 %" },
      { indicator: "PERFORMANCE", period: "THREE_YEARS", value: "8,4 %" },
      { indicator: "PERFORMANCE", period: "FIVE_YEARS", value: "6,7 %" },
      { indicator: "PERFORMANCE", period: "TEN_YEARS", value: "9,1 %" }
    ],
    currencies: { CURRENCY: "EUR" }
  };
}

function apiResponse() {
  const products: any[] = Array.from({ length: 655 }, (_, index) => apiProduct(index));
  products[654].characteristics.VISIBILITY_EXCEPTIONS = [
    { countryCode: "FRA", userProfileName: "INSTIT" }
  ];
  products.push({
    ...apiProduct(655),
    productType: "LIQUIDATED_PRODUCT"
  });
  return { products };
}

afterEach(() => vi.unstubAllGlobals());

describe("Amundi catalogue Worker integration", () => {
  it("loads the official API and returns the 654 visible, distinct ETF ISINs", async () => {
    let postedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(apiUrl);
      expect(init?.method).toBe("POST");
      postedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(apiResponse()), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }));

    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as {
      status: string; completeness: string; sourceTotal: number; productCount: number;
      pageCount: number; products: Array<{ isin: string; ticker: string; name: string; nav: string | null; performance1y: string | null; performance3y: string | null; performance5y: string | null; performance10y: string | null; srri: string | null }>;
      audit: { apiProductRecords: number; activeProductRecords: number; excludedByFranceInstitutionalVisibility: number };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.sourceTotal).toBe(654);
    expect(body.productCount).toBe(654);
    expect(body.products).toHaveLength(654);
    expect(new Set(body.products.map(product => product.isin)).size).toBe(654);
    expect(body.completeness).toBe("complete");
    expect(body.pageCount).toBe(1);
    expect(body.audit).toMatchObject({
      apiProductRecords: 656, activeProductRecords: 655,
      excludedByFranceInstitutionalVisibility: 1
    });
    expect(body.products[0]).toMatchObject({
      isin: "LU0000000001", ticker: "ETF1 FP", name: "Amundi Test ETF 1",
      currency: "EUR", ongoingCharges: "0.18 %", sfdr: "Article 8",
      exposure: "MSCI World", nav: "123.45", performanceYtd: "7.5", performance1y: "12.3",
      performance3y: "8.4", performance5y: "6.7", performance10y: "9.1", srri: "4"
    });
    expect(body.products.some(product => product.isin === "LU0000000655")).toBe(false);
    expect(postedBody).toMatchObject({
      productType: "ALL",
      context: {
        countryName: "France", countryCode: "FRA",
        languageName: "French", languageCode: "fr", userProfileName: "INSTIT"
      },
      filters: [], sortCriterias: []
    });
    expect(postedBody.characteristics).toContain("ISIN");
    expect(postedBody.characteristics).toContain("MAIN_LISTINGS");
    expect(postedBody.characteristics).toContain("SRRI");
    expect(postedBody.metrics).toContainEqual({ indicator: "PERFORMANCE", period: "YEAR_TO_DATE" });
    for (const period of ["ONE_YEAR", "THREE_YEARS", "FIVE_YEARS", "TEN_YEARS"]) {
      expect(postedBody.metrics).toContainEqual({ indicator: "PERFORMANCE", period });
    }
  });

  it("supports server-side search by name, ISIN, ticker, WKN and exposure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      products: [apiProduct(0), apiProduct(1, { WKN: "SPECIALWKN", ETF_CLASSIFICATION2: "Nasdaq 100" })]
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi?q=specialwkn"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as { products: Array<{ isin: string }> };
    expect(body.products).toHaveLength(1);
    expect(body.products[0].isin).toBe("LU0000000002");
  });

  it("refuses to call a partial or duplicated catalogue complete", async () => {
    const duplicate = apiProduct(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      products: [apiProduct(0), duplicate]
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as { status: string; completeness: string; audit: { duplicateIsinCount: number } };
    expect(body.status).toBe("unparsed_source");
    expect(body.completeness).toBe("partial");
    expect(body.audit.duplicateIsinCount).toBe(1);
  });

  it("returns no catalogue when the official API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as { status: string; products: unknown[] };
    expect(response.status).toBe(502);
    expect(body.status).toBe("source_unavailable");
    expect(body.products).toHaveLength(0);
  });
});
