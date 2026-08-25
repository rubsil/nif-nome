# API

Prototype API for NIF → Nome.

## Run locally

From the repository root:

```bash
python api/server.py
```

The development server listens on `127.0.0.1:8000`.

## Endpoints

`GET /health`

Returns a simple health response.

`GET /api/company/{nif}`

Returns the company record for a 9-digit NIF. A missing NIF returns HTTP 404.

## Storage

The prototype reads `web/data/companies.json`. This is intentionally temporary;
the production version will use a real database and separate read/write layers.
