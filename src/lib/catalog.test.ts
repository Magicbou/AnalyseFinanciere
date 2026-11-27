import { describe, expect, it } from "vitest";
import { matchesAmundiSearch, type AmundiCatalogProduct } from "./catalog";

const product: AmundiCatalogProduct = {
  name: "Amundi MSCI World UCITS ETF Acc",
  isin: "LU1681043599",
  ticker: "CW8 FP",
  wkn: "A2H59Q",
  currency: "EUR",
  ongoingCharges: "0,18 %",
  assetsUnderManagement: null,
  sfdr: "Article 8",
  exposure: "MSCI World",
  nav: "520.12",
  navDate: "26/11/2026",
  performanceYtd: null,
  performance1y: null,
  sourceUrl: "https://www.amundietf.fr/"
};

describe("Amundi ETF catalogue search", () => {
  it.each([
    ["nom du fonds", "MSCI World UCITS"],
    ["ISIN", "lu1681043599"],
    ["ticker", "cw8"],
    ["WKN", "A2H59Q"],
    ["indice / exposition", "MSCI World"],
    ["devise", "EUR"],
    ["classification SFDR", "article 8"]
  ])("retrieves a product by %s", (_label, query) => {
    expect(matchesAmundiSearch(product, query)).toBe(true);
  });

  it("supports multi-word searches across different fields", () => {
    expect(matchesAmundiSearch(product, "Amundi LU1681043599")).toBe(true);
    expect(matchesAmundiSearch(product, "World A2H59Q")).toBe(true);
  });

  it("ignores accents and case and returns all products for an empty query", () => {
    expect(matchesAmundiSearch(product, "AMUNDI")).toBe(true);
    expect(matchesAmundiSearch(product, "")).toBe(true);
  });

  it("does not return a product when a search token is absent", () => {
    expect(matchesAmundiSearch(product, "Nasdaq 100")).toBe(false);
  });
});
