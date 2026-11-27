import { describe, expect, it } from "vitest";
import { countUniqueAmundiProducts, discoverAmundiPaginationLinks, extractAmundiTotal, parseAmundiRows } from "./amundi-parser";
const source = "https://www.amundietf.fr/fr/particuliers/produits-etf/recherche";
const row = "<div>ETF_FINDER_SUMMARY</div><table><tbody><tr>" +
  "<td><a>SP5C FP</a></td><td>LYX0Q9</td><td>Amundi Core S&amp;P 500 Swap UCITS ETF Acc Code ISIN LU1135865084</td>" +
  "<td>USD</td><td>0,05 %</td><td>31 882,3 M USD</td><td>Article 6</td><td>87 contrats</td>" +
  "<td>Etats-Unis</td><td>5.2362 25/11/2026</td><td>6,17 %</td><td>8,52 %</td>" +
  "</tr></tbody></table>";
describe("Amundi public catalogue parser", () => {
  it("extracts a product row and keeps NAV date distinct", () => {
    const [product] = parseAmundiRows(row, source);
    expect(product).toMatchObject({ ticker: "SP5C FP", isin: "LU1135865084", currency: "USD", nav: "5.2362", navDate: "25/11/2026", ongoingCharges: "0,05 %" });
    expect(product.name).toContain("S&P 500");
  });
  it("recognizes the official result count format", () => expect(extractAmundiTotal("<span>654 produit(s)trouvé(s)</span>")).toBe(654));
  it("counts unique products by ISIN, not multiple exchange listings", () => {
    expect(countUniqueAmundiProducts([
      { isin: "LU1135865084" }, { isin: "lu1135865084" }, { isin: "IE000BI8OT95" }, { isin: "" }
    ])).toBe(2);
  });
  it("only follows pagination links on the official catalogue path", () => {
    const html = '<a href="?page=1">1</a><a href="https://evil.example/?page=2">x</a><a href="/other?page=3">y</a>';
    expect(discoverAmundiPaginationLinks(html, source)).toEqual([source + "?page=1"]);
  });
});
