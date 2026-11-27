PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  isin TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  product_name TEXT NOT NULL,
  share_class_currency TEXT,
  replication_method TEXT,
  income_policy TEXT,
  domicile TEXT,
  sfdr_classification TEXT,
  ongoing_charges TEXT,
  assets_under_management TEXT,
  exposure_label TEXT,
  source_url TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  source_payload_hash TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified_source','needs_review','stale')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  wkn TEXT,
  exchange_mic TEXT,
  exchange_name TEXT,
  trading_currency TEXT,
  source_url TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  UNIQUE(instrument_id, ticker, exchange_mic)
);

CREATE TABLE IF NOT EXISTS market_observations (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('last_trade','bid','ask','official_nav','indicative_nav')),
  value REAL NOT NULL,
  currency TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  delay_seconds INTEGER,
  source_provider TEXT NOT NULL,
  source_reference TEXT,
  is_realtime INTEGER NOT NULL DEFAULT 0 CHECK (is_realtime IN (0,1)),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified','delayed','stale','unverified'))
);

CREATE INDEX IF NOT EXISTS idx_market_observations_listing_time ON market_observations(listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_instrument ON listings(instrument_id);
CREATE INDEX IF NOT EXISTS idx_instruments_issuer ON instruments(issuer);
