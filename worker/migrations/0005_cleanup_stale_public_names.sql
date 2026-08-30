-- Remove stale / obviously incorrect public-name associations left by earlier
-- broad-page extraction. Valid names are re-discovered from explicit sources.
DELETE FROM name_evidence
WHERE public_name_id IN (
  SELECT pn.id
  FROM public_names pn
  LEFT JOIN companies c ON c.nif = pn.nif
  WHERE lower(trim(pn.name)) IN ('english', 'spanish')
     OR (c.legal_name IS NOT NULL AND lower(trim(pn.name)) = lower(trim(c.legal_name)))
     OR (pn.nif = '512031584' AND lower(trim(pn.name)) = lower('INDUSTRIA DE PANIFICAÇÃO HUMBERTO GOULART, LDA'))
);

DELETE FROM public_names
WHERE lower(trim(name)) IN ('english', 'spanish')
   OR EXISTS (
      SELECT 1 FROM companies c
      WHERE c.nif = public_names.nif
        AND c.legal_name IS NOT NULL
        AND lower(trim(public_names.name)) = lower(trim(c.legal_name))
   )
   OR (nif = '512031584' AND lower(trim(name)) = lower('INDUSTRIA DE PANIFICAÇÃO HUMBERTO GOULART, LDA'));

UPDATE companies
SET public_name = NULL
WHERE lower(trim(COALESCE(public_name, ''))) IN ('english', 'spanish', 'industria de panificação humberto goulart, lda');
