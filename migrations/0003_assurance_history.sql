-- Assurance-vie history, kept separate by data layer.
CREATE TABLE IF NOT EXISTS assurance_euro_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_slug TEXT NOT NULL,
  fund_name TEXT,
  rate_year INTEGER NOT NULL CHECK (rate_year BETWEEN 1900 AND 2200),
  rate_pct REAL NOT NULL CHECK (rate_pct > -100 AND rate_pct < 1000),
  source_url TEXT NOT NULL,
  source_checked_at TEXT,
  collected_date TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  UNIQUE (contract_slug, rate_year, source_url, collected_date)
);
CREATE INDEX IF NOT EXISTS idx_assurance_euro_rates_contract_year
  ON assurance_euro_rates (contract_slug, rate_year);

-- Reserved for verified contract/ISIN-level UC observations.
-- Generic ETF catalogues are not proof that a contract offers a support.
CREATE TABLE IF NOT EXISTS assurance_uc_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_slug TEXT NOT NULL,
  isin TEXT NOT NULL CHECK (length(isin) = 12),
  support_name TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  value REAL NOT NULL CHECK (value > 0),
  currency TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('nav', 'performance')),
  period TEXT,
  source_url TEXT NOT NULL,
  source_checked_at TEXT,
  collected_at TEXT NOT NULL,
  UNIQUE (contract_slug, isin, observation_date, data_type, period, source_url)
);
CREATE INDEX IF NOT EXISTS idx_assurance_uc_contract_isin_date
  ON assurance_uc_observations (contract_slug, isin, observation_date);
