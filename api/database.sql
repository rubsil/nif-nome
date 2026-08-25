-- NIF -> Nome production schema
-- PostgreSQL

CREATE TABLE companies (
    id BIGSERIAL PRIMARY KEY,
    nif CHAR(9) NOT NULL UNIQUE,
    legal_name TEXT NOT NULL,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'disputed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public_names (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    name_type TEXT NOT NULL DEFAULT 'commercial'
        CHECK (name_type IN ('commercial', 'brand', 'establishment', 'other')),
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0
        CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'verified', 'rejected', 'disputed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX public_names_normalized_idx ON public_names (normalized_name);
CREATE INDEX public_names_company_idx ON public_names (company_id);

CREATE TABLE sources (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'web'
        CHECK (source_type IN ('official', 'government', 'directory', 'web', 'community', 'other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE evidence (
    id BIGSERIAL PRIMARY KEY,
    public_name_id BIGINT NOT NULL REFERENCES public_names(id) ON DELETE CASCADE,
    source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    evidence_type TEXT NOT NULL,
    matched_nif BOOLEAN NOT NULL DEFAULT FALSE,
    matched_address BOOLEAN NOT NULL DEFAULT FALSE,
    matched_phone BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (public_name_id, source_id, evidence_type)
);

CREATE TABLE suggestions (
    id BIGSERIAL PRIMARY KEY,
    nif CHAR(9) NOT NULL,
    suggested_name TEXT NOT NULL,
    source_url TEXT,
    submitter_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX suggestions_nif_idx ON suggestions (nif);
CREATE INDEX suggestions_status_idx ON suggestions (status);
