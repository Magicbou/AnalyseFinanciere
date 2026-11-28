import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

afterEach(() => vi.unstubAllGlobals());

describe("ETF historical prices from Yahoo Finance", () => {
  it("retrieves adjusted daily prices and calculates calendar-year returns", async () => {
    const currentYear = new Date().getUTCFullYear();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const previous = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const priorYearEnd = (currentYear - 1) + "-12-31";
    const yearBeforeEnd = (currentYear - 2) + "-12-31";
    const dates = [yearBeforeEnd, priorYearEnd, previous, yesterday];
    const payload = {
      chart: {
        error: null,
        result: [{
          meta: { currency: "EUR", exchangeName: "PAR", symbol: "CW8.PA" },
          timestamp: dates.map(date => Date.parse(date + "T12:00:00Z") / 1000),
          indicators: {
            quote: [{
              open: [89, 99.1, 100.5, 100.5],
              high: [91, 101, 103, 103],
              low: [88, 98.5, 100, 100],
              close: [90, 100, 100.5, 102.34],
              volume: [900, 1200, 2000, 2400]
            }],
            adjclose: [{ adjclose: [90, 100, 100.5, 102.34] }]
          }
        }]
      }
    };
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("query1.finance.yahoo.com/v8/finance/chart/CW8.PA");
      expect(String(input)).toContain("range=10y");
      expect(String(input)).toContain("interval=1d");
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await worker.fetch(new Request(
      "https://investpilot.test/api/market/history?isin=LU1681043599&ticker=CW8%20FP"
    ), { ASSETS: { fetch: async request => new Response(request.url) } });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.symbol).toBe("CW8.PA");
    expect(body.adjusted).toBe(true);
    expect(body.currency).toBe("EUR");
    expect(body.points).toHaveLength(4);
    expect(body.points[0].date).toBe(yearBeforeEnd);
    expect(body.points[3].close).toBe(102.34);
    expect(body.points[3].volume).toBe(2400);
    expect(body.annualReturns[0].year).toBe(currentYear - 1);
    expect(body.annualReturns[0].returnPct).toBeCloseTo((100 / 90 - 1) * 100, 8);
    expect(body.annualReturns[1].period).toBe("year_to_date");
    expect(body.annualReturns[1].returnPct).toBeCloseTo(2.34, 8);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("does not invent a Yahoo symbol when the Amundi ticker suffix is unknown", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(
      "https://investpilot.test/api/market/history?isin=LU1681043599&ticker=UNKNOWN%20ZZ"
    ), { ASSETS: { fetch: async request => new Response(request.url) } });
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.status).toBe("unsupported_listing");
    expect(upstream).not.toHaveBeenCalled();
  });
});
