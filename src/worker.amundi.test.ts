import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

const source = "https://www.amundietf.fr/fr/professionnels/produits-etf/recherche";
const total = 654;

function productRow(index: number): string {
  const isin = `LU${String(index + 1).padStart(10, "0")}`;
  return "<tr>" +
    `<td><a>ETF${index + 1} FP</a></td><td>WKN${index + 1}</td>` +
    `<td>Amundi Test ETF ${index + 1} Code ISIN ${isin}</td>` +
    "<td>EUR</td><td>0,10 %</td><td>100 M EUR</td><td>Article 6</td><td>1 contrat</td>" +
    "<td>Monde</td><td>100,00 25/11/2026</td><td>1,00 %</td><td>2,00 %</td></tr>";
}

function cataloguePage(start: number, count: number, includeTotal = false): string {
  const summary = includeTotal ? `<span>${total} produit(s)trouvé(s)</span>` : "";
  return `<div>ETF_FINDER_SUMMARY ${summary}</div><table><tbody>${Array.from(
    { length: count }, (_, offset) => productRow(start + offset)
  ).join("")}</tbody></table>`;
}

afterEach(() => vi.unstubAllGlobals());

describe("Amundi catalogue Worker integration", () => {
  it("fetches every numbered page and returns all 654 distinct ISINs", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      calls.push(url.toString());
      if (url.origin !== new URL(source).origin || url.pathname !== new URL(source).pathname) {
        return new Response("unexpected upstream", { status: 404 });
      }
      const page = Number(url.searchParams.get("page") ?? "0");
      const start = page * 50;
      const count = Math.min(50, total - start);
      return new Response(cataloguePage(start, count, page === 0), { status: 200 });
    }));

    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as {
      completeness: string; sourceTotal: number; productCount: number;
      pageCount: number; products: Array<{ isin: string }>;
      audit: { fetchedPages: number; failedPages: number; discoveredAdditionalPages: number };
    };

    expect(response.status).toBe(200);
    expect(body.sourceTotal).toBe(total);
    expect(body.productCount).toBe(total);
    expect(body.products).toHaveLength(total);
    expect(new Set(body.products.map(product => product.isin)).size).toBe(total);
    expect(body.completeness).toBe("complete");
    expect(body.pageCount).toBe(14);
    expect(body.audit).toMatchObject({ fetchedPages: 14, failedPages: 0, discoveredAdditionalPages: 13 });
    expect(calls).toHaveLength(14);
    expect(calls.slice(1).map(url => new URL(url).searchParams.get("page"))).toEqual(
      Array.from({ length: 13 }, (_, index) => String(index + 1))
    );
  });

  it("marks the catalogue partial when Amundi repeats the first page for every pager URL", async () => {
    const firstPage = cataloguePage(0, 50, true);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ products: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(firstPage, { status: 200 })));

    const response = await worker.fetch(
      new Request("https://investpilot.test/api/catalog/amundi"),
      { ASSETS: { fetch: async request => new Response(request.url) } }
    );
    const body = await response.json() as {
      completeness: string; productCount: number;
      audit: { fetchedPages: number; failedPages: number };
    };

    expect(body.completeness).toBe("partial");
    expect(body.productCount).toBe(50);
    expect(body.audit).toMatchObject({ fetchedPages: 1, failedPages: 13 });
  });
});
