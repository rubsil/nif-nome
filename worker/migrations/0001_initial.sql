CREATE TABLE IF NOT EXISTS companies (
  nif TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  public_name TEXT,
  location TEXT,
  confidence REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_companies_legal_name ON companies(legal_name);
CREATE INDEX IF NOT EXISTS idx_companies_public_name ON companies(public_name);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nif TEXT NOT NULL,
  name TEXT NOT NULL,
  source_url TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
