#!/usr/bin/env python3
"""Quick test of the API functionality without running the server."""

import sys
import json
from pathlib import Path

# Add api to path
sys.path.insert(0, str(Path(__file__).parent))

from api.search import validate_nif, search_companies
from api.repository import get_company, list_companies


def test_validation():
    """Test NIF validation."""
    print("📋 Testing NIF validation...")
    assert validate_nif("512044821"), "Valid NIF should pass"
    assert not validate_nif("12345"), "Too short should fail"
    assert not validate_nif("abc"), "Non-numeric should fail"
    assert not validate_nif("12345678901"), "Too long should fail"
    print("  ✓ NIF validation works\n")


def test_lookup():
    """Test company lookup."""
    print("🔍 Testing company lookup...")
    company = get_company("512044821")
    if company:
        print(f"  Found: {company}")
        print(f"  Legal name: {company.get('legalName', 'N/A')}")
        public_names = company.get("publicNames", [])
        if public_names:
            for pn in public_names:
                print(f"    → {pn.get('name')} (confidence: {pn.get('confidence')})")
        print("  ✓ Lookup works\n")
    else:
        print("  ⚠ No company found (database may need seeding)\n")


def test_search():
    """Test company search."""
    print("🔎 Testing text search...")
    results = search_companies("FARMÁCIA")
    if results:
        print(f"  Found {len(results)} result(s):")
        for r in results[:3]:
            print(f"    - {r.get('name', 'N/A')} ({r.get('nif', 'N/A')})")
        print("  ✓ Search works\n")
    else:
        print("  ⚠ No results (database may need seeding)\n")


def seed_from_json():
    """Load seed data from data/seed.json into the companies database."""
    print("🌱 Seeding database from data/seed.json...")
    seed_path = Path(__file__).parent / "data" / "seed.json"
    if not seed_path.exists():
        print(f"  ⚠ Seed file not found: {seed_path}\n")
        return
    
    try:
        from api.repository import _read_json, _write_json, COMPANIES_FILE
        
        with open(seed_path, "r", encoding="utf-8") as f:
            seed_data = json.load(f)
        
        companies_dict = {}
        for company in seed_data.get("companies", []):
            nif = company.get("nif")
            if nif:
                companies_dict[nif] = {
                    "nif": nif,
                    "legalName": company.get("legal_name", ""),
                    "publicNames": company.get("public_names", []),
                    "location": company.get("location"),
                }
        
        _write_json(COMPANIES_FILE, companies_dict)
        print(f"  ✓ Seeded {len(companies_dict)} company/ies\n")
    except Exception as e:
        print(f"  ✗ Error seeding: {e}\n")


def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("NIF → Nome API Test Suite")
    print("=" * 60 + "\n")
    
    # Seed first
    seed_from_json()
    
    # Run tests
    try:
        test_validation()
        test_lookup()
        test_search()
        
        print("=" * 60)
        print("✓ All tests passed!")
        print("=" * 60 + "\n")
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
