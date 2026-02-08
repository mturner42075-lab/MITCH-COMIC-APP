-- Comic inventory schema for PostgreSQL
-- Core fields mirror CLZ-style inventory with open-source metadata capture.

CREATE TYPE signature_status AS ENUM (
  'none',
  'signed',
  'witnessed',
  'cgc_signature_series'
);

CREATE TYPE slab_status AS ENUM (
  'raw',
  'cgc',
  'cbc',
  'pgx',
  'other'
);

CREATE TABLE IF NOT EXISTS comics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  issue_number TEXT NOT NULL,
  publisher TEXT,
  grade TEXT,
  signature_status signature_status NOT NULL DEFAULT 'none',
  slab_status slab_status NOT NULL DEFAULT 'raw',
  is_key BOOLEAN NOT NULL DEFAULT FALSE,
  is_owned BOOLEAN NOT NULL DEFAULT TRUE,
  cover_url TEXT,
  barcode TEXT,
  notes TEXT,
  synopsis TEXT,
  series TEXT,
  volume TEXT,
  issue_title TEXT,
  variant_description TEXT,
  format TEXT,
  added_date DATE,
  cover_price NUMERIC,
  cover_currency TEXT,
  page_count INTEGER,
  age TEXT,
  language TEXT,
  country TEXT,
  key_reason TEXT,
  series_group TEXT,
  collection_name TEXT,
  collection_hash TEXT,
  quantity INTEGER,
  cover_date DATE,
  publication_date DATE,
  release_date DATE,
  metron_issue_id INTEGER,
  metron_series_id INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comics_title ON comics (title);
CREATE INDEX IF NOT EXISTS idx_comics_publisher ON comics (publisher);
CREATE INDEX IF NOT EXISTS idx_comics_issue_number ON comics (issue_number);
CREATE INDEX IF NOT EXISTS idx_comics_is_owned ON comics (is_owned);
CREATE INDEX IF NOT EXISTS idx_comics_barcode ON comics (barcode);

ALTER TABLE comics
  ADD CONSTRAINT comics_unique_entry UNIQUE (title, issue_number, publisher, is_owned);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comics_updated_at ON comics;
CREATE TRIGGER trg_comics_updated_at
BEFORE UPDATE ON comics
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();
