-- Remove the false commercial-name association created by an earlier
-- broad-page extraction. The real company is associated with Bico Doce,
-- but that name must only be added again when an explicit public source
-- confirms it.
DELETE FROM name_evidence
WHERE public_name_id IN (
  SELECT id FROM public_names
  WHERE nif = '512031584'
    AND lower(name) = lower('INDUSTRIA DE PANIFICAÇÃO HUMBERTO GOULART, LDA')
);
DELETE FROM public_names
WHERE nif = '512031584'
  AND lower(name) = lower('INDUSTRIA DE PANIFICAÇÃO HUMBERTO GOULART, LDA');
UPDATE companies
SET public_name = NULL, confidence = CASE WHEN confidence > 0.65 THEN confidence ELSE 0.65 END
WHERE nif = '512031584';
