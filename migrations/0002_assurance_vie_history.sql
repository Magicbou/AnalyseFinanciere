PRAGMA foreign_keys = ON;

-- Contract identity is deliberately separate from support identity:
-- a contract can expose many share classes, and a share class can be
-- available in multiple contracts.
CREATE TABLE IF NOT EXISTS insurance_contracts (
  contract_id TEXT PRIMARY KEY,
  contract_name TEXT NOT NULL,
  insurer TEXT,
  distributor TEXT,
  management_mode TEXT,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  source_payload_hash TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insurance_contract_supports (
  contract_id TEXT NOT NULL REFERENCES insurance_contracts(contract_id) ON DELETE CASCADE,
  isin TEXT NOT NULL CHECK (length(isin) = 12),
  support_name TEXT,
  share_class_name TEXT,
  support_category TEXT,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  source_payload_hash TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contract_id, isin)
);

CREATE TABLE IF NOT EXISTS uc_nav_observations (
  isin TEXT NOT NULL CHECK (length(isin) = 12),
  nav_date TEXT NOT NULL,
  nav REAL NOT NULL CHECK (nav > 0),
  currency TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  source_payload_hash TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'needs_review', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (isin, nav_date, source_name)
);

CREATE TABLE IF NOT EXISTS insurance_data_quality_checks (
  check_id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
  checked_at TEXT NOT NULL,
  records_checked INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_contract_supports_isin
  ON insurance_contract_supports(isin, contract_id);
CREATE INDEX IF NOT EXISTS idx_uc_nav_isin_date
  ON uc_nav_observations(isin, nav_date DESC);
CREATE INDEX IF NOT EXISTS idx_uc_nav_date
  ON uc_nav_observations(nav_date DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_quality_dataset_date
  ON insurance_data_quality_checks(dataset, checked_at DESC);
