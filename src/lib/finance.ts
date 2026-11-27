export type ContributionInput = { initialCapital: number; monthlyContribution: number; years: number };
export function calculateContributions({ initialCapital, monthlyContribution, years }: ContributionInput): number {
  for (const [name, value] of Object.entries({ initialCapital, monthlyContribution, years })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  }
  if (!Number.isInteger(years)) throw new RangeError("years must be an integer");
  return initialCapital + monthlyContribution * years * 12;
}
export function formatEuro(value: number, locale = "fr-FR"): string {
  if (!Number.isFinite(value)) throw new RangeError("value must be finite");
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
}
