import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from sources.search_plan import CompanyIdentity, build_queries, legal_name_without_suffix


def test_removes_common_legal_suffix():
    assert legal_name_without_suffix("SOUSA & SILVA, LDA") == "SOUSA & SILVA"
    assert legal_name_without_suffix("Exemplo Limitada") == "Exemplo"


def test_build_queries_contains_nif_and_identity():
    company = CompanyIdentity(
        nif="512044821",
        legal_name="SOUSA & SILVA, LDA",
        address="Rua D. Pedro IV, 31",
        city="Horta",
        phone="292 292 968",
    )
    queries = build_queries(company)
    assert queries[0] == '"512044821"'
    assert '"512044821" "designação comercial"' in queries
    assert '"SOUSA & SILVA" "Horta"' in queries
    assert '"512044821" "Rua D. Pedro IV, 31"' in queries
    assert len(queries) == len(set(queries))


def test_rejects_invalid_nif():
    company = CompanyIdentity(nif="123", legal_name="Example, LDA")
    try:
        build_queries(company)
    except ValueError as exc:
        assert "9 digits" in str(exc)
    else:
        raise AssertionError("Expected invalid NIF to be rejected")
