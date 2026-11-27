import { describe, expect, it } from "vitest";
import { calculateContributions, formatEuro } from "./finance";

describe("calculateContributions", () => {
  it("adds initial capital and recurring contributions without assumed return", () => {
    expect(calculateContributions({ initialCapital: 10_000, monthlyContribution: 200, years: 10 })).toBe(34_000);
  });
  it("rejects negative and non-finite inputs", () => {
    expect(() => calculateContributions({ initialCapital: -1, monthlyContribution: 0, years: 1 })).toThrow(RangeError);
    expect(() => calculateContributions({ initialCapital: 0, monthlyContribution: Number.NaN, years: 1 })).toThrow(RangeError);
  });
  it("requires a whole number of years", () => {
    expect(() => calculateContributions({ initialCapital: 0, monthlyContribution: 10, years: 1.5 })).toThrow(RangeError);
  });
});
describe("formatEuro", () => {
  it("formats finite values as euros", () => expect(formatEuro(1234)).toContain("€"));
  it("rejects non-finite values", () => expect(() => formatEuro(Infinity)).toThrow(RangeError));
});
