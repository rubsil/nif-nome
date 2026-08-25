-- NIF → Nome database schema
-- PostgreSQL-compatible SQL

CREATE TABLE companies (
    nif VARCHAR(9) PRIMARY KEY,
    legal_name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    postal_code TEXT,
    website TEXT,
    cae VARCHAR(10),
    status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public_names (
    id BIGSERIAL PRIMARY KEY,
    nif VARCHAR(9) NOT NULL REFERENCES companies(nif) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_type TEXT NOT NULL DEFAULT 'commercial',
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
    verified_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (nif, name, name_type)
);

CREATE TABLE sources (
    id BIGSERIAL PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'web',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE name_evidence (
    id BIGSERIAL PRIMARY KEY,
    public_name_id BIGINT NOT NULL REFERENCES public_names(id) ON DELETE CASCADE,
    source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
    evidence_url TEXT,
    evidence_text TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_reports (
    id BIGSERIAL PRIMARY KEY,
    nif VARCHAR(9) NOT NULL REFERENCES companies(nif) ON DELETE CASCADE,
    suggested_name TEXT,
    evidence_url TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_public_names_nif ON public_names(nif);
CREATE INDEX idx_public_names_name ON public_names(name);
CREATE INDEX idx_user_reports_status ON user_reports(status);
