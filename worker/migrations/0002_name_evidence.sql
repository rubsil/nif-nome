CREATE TABLE IF NOT EXISTS public_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nif TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'nome comercial',
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(nif, name)
);

CREATE TABLE IF NOT EXISTS name_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_name_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT,
  source_url TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(public_name_id) REFERENCES public_names(id) ON DELETE CASCADE,
  UNIQUE(public_name_id, source_name, source_url)
);

CREATE INDEX IF NOT EXISTS idx_public_names_nif ON public_names(nif);
CREATE INDEX IF NOT EXISTS idx_name_evidence_public_name ON name_evidence(public_name_id);
