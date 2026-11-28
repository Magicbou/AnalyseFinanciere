import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

afterEach(() => vi.unstubAllGlobals());

describe("Euronext historical ETF prices", () => {
  it("retrieves and parses adjusted daily history for an ISIN and Euronext market", async () => {
    const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const previous = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const currentYear = new Date().getUTCFullYear();
    const priorYearEnd = (currentYear - 1) + "-12-31";
    const yearBeforeEnd = (currentYear - 2) + "-12-31";
    const format = (value: string) => {
      const [year, month, day] = value.split("-");
      return day + "/" + month + "/" + year;
    };
    const html = [
      "<table><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Last</th><th>Close</th><th>Number of shares</th></tr></thead>",
      "<tbody><tr><td>" + format(yearBeforeEnd) + "</td><td>89.00</td><td>91.00</td><td>88.00</td><td>90.00</td><td>90.00</td><td>900</td></tr>",
      "<tr><td>" + format(priorYearEnd) + "</td><td>99.10</td><td>101.00</td><td>98.50</td><td>100.00</td><td>100.00</td><td>1,200</td></tr>",
      "<tr><td>" + format(previous) + "</td><td>100.50</td><td>103.00</td><td>100.00</td><td>100.50</td><td>100.50</td><td>2,000</td></tr>",
      "<tr><td>" + format(today) + "</td><td>100.50</td><td>103.00</td><td>100.00</td><td>102.34</td><td>102.34</td><td>2,400</td></tr></tbody></table>"
    ].join("");
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("adjusted=Y");
      expect(String(init?.body)).toContain("nbSession=10");
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await worker.fetch(new Request(
      "https://investpilot.test/api/market/history?isin=LU1681043599&market=XPAR&from=" + yearBeforeEnd + "&to=" + today
    ), { ASSETS: { fetch: async request => new Response(request.url) } });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.points).toHaveLength(4);
    expect(body.points[0].date).toBe(yearBeforeEnd);
    expect(body.points[3].close).toBe(102.34);
    expect(body.points[3].volume).toBe(2400);
    expect(body.annualReturns[0].year).toBe(currentYear - 1);
    expect(body.annualReturns[0].returnPct).toBeCloseTo((100 / 90 - 1) * 100, 8);
    expect(body.annualReturns[1].period).toBe("year_to_date");
    expect(body.annualReturns[1].returnPct).toBeCloseTo(2.34, 8);
    expect(body.methodology).toContain("deux ans");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported markets before contacting Euronext", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request(
      "https://investpilot.test/api/market/history?isin=LU1681043599&market=XETR"
    ), { ASSETS: { fetch: async request => new Response(request.url) } });
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
