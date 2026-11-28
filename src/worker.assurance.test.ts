import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

const feeUrl = "https://www.data.gouv.fr/api/1/datasets/r/3a1608bf-25e2-421f-bbd5-e46ae42256ab";
const euroUrl = "https://www.data.gouv.fr/api/1/datasets/r/d6c8853b-b38e-4aa3-a119-4cb7935429a6";
const years = Array.from({ length: 11 }, (_, index) => 2015 + index);

function csv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map(row => row.map(value => value.includes(";") || value.includes('"') ? '"' + value.replaceAll('"', '""') + '"' : value).join(";")).join("\n");
}

afterEach(() => vi.unstubAllGlobals());

describe("Assurance-vie performance rankings", () => {
  it("keeps every AV contract regardless of ETF count and computes 1, 3, 5 and 8 year euro-fund returns", async () => {
    const feeHeaders = ["slug","contrat","type","gestion","assureur","courtier","frais_versement_pct","frais_gestion_uc_pct","nombre_supports","nombre_etf","url_source_principale","date_releve"];
    const feeCsv = csv(feeHeaders, [
      ["av-avec-etf","Contrat avec ETF","assurance-vie","libre","Assureur A","Courtier A","0","0.5","100","20","https://example.test/fees-a","28/11/2026"],
      ["av-sans-etf","Contrat sans ETF","assurance-vie","libre","Assureur B","Courtier B","0","0.6","12","0","https://example.test/fees-b","28/11/2026"],
      ["per-exclu","PER exclu","PER","libre","Assureur C","Courtier C","0","0.5","50","5","https://example.test/per","28/11/2026"]
    ]);
    const euroHeaders = ["slug","contrat","type","fonds_euros",...years.map(year=>`taux_${year}_pct`),"url_source_principale","date_releve"];
    const ratesA = years.map(year => year >= 2018 ? (year === 2025 ? "3" : year === 2024 ? "2.5" : "2") : "");
    const euroCsv = csv(euroHeaders, [
      ["av-avec-etf","Contrat avec ETF","assurance-vie","Fonds A",...ratesA,"https://example.test/euro-a","28/11/2026"],
      ["av-euro-only","Z contrat euro seul","assurance-vie","Fonds Z",...ratesA,"https://example.test/euro-z","28/11/2026"]
    ]);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === feeUrl) return new Response(feeCsv, { status: 200 });
      if (url === euroUrl) return new Response(euroCsv, { status: 200 });
      throw new Error("Unexpected URL " + url);
    }));

    const response = await worker.fetch(new Request("https://investpilot.test/api/assurance-vie/contracts"), {
      ASSETS: { fetch: async request => new Response(request.url) }
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.contractCount).toBe(3);
    expect(body.contracts.map((contract: any) => contract.slug)).toEqual(["av-avec-etf","av-sans-etf","av-euro-only"]);
    const withEtf = body.contracts.find((contract: any) => contract.slug === "av-avec-etf");
    const withoutEtf = body.contracts.find((contract: any) => contract.slug === "av-sans-etf");
    expect(withEtf.etfCount).toBe(20);
    expect(withEtf.euroPerformance["1"].annualizedPct).toBeCloseTo(3, 8);
    expect(withEtf.euroPerformance["3"].observations).toBe(3);
    expect(withEtf.euroPerformance["3"].cumulativePct).toBeCloseTo((1.02 * 1.025 * 1.03 - 1) * 100, 8);
    expect(withEtf.euroPerformance["5"].annualizedPct).not.toBeNull();
    expect(withEtf.euroPerformance["8"].annualizedPct).not.toBeNull();
    expect(withoutEtf.etfCount).toBe(0);
    expect(withoutEtf.euroPerformance["1"].annualizedPct).toBeNull();
    expect(withoutEtf.euroPerformance["8"].annualizedPct).toBeNull();
    const euroOnly = body.contracts.find((contract: any) => contract.slug === "av-euro-only");
    expect(euroOnly.name).toBe("Z contrat euro seul");
    expect(euroOnly.entryFeePct).toBeNull();
    expect(euroOnly.euroPerformance["1"].annualizedPct).toBeCloseTo(3, 8);
  });
});
