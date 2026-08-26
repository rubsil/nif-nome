# NIF → Nome: Desenvolvimento

## Estrutura do projeto

```
nif-nome/
├── api/                    # Backend Python (API HTTP + lógica)
│   ├── server.py          # Servidor de desenvolvimento (HTTP simples)
│   ├── routes.py          # Handlers de rotas
│   ├── repository.py      # Persistência (JSON em dev, DB em produção)
│   ├── search.py          # Busca e validação
│   ├── confidence.py      # Cálculo de confiança das fontes
│   ├── discovery.py       # Ferramentas de descoberta automática
│   ├── discovery_job.py   # Pipeline de descoberta em lote
│   └── sources/           # Importadores de dados externos
│       ├── directories.py # Mapeamento de diretórios empresariais
│       └── web_search.py  # Interface para resultados de web search
├── web/                   # Frontend (HTML/JS)
│   ├── index.html        # Página de consulta
│   ├── admin.html        # Interface de revisão de candidatos
│   └── app.js            # Lógica do cliente
├── data/
│   └── seed.json         # Dados de exemplo
├── database/
│   └── schema.sql        # Modelo de dados (referência)
└── tests/                # Testes
    └── test_api.py       # Testes end-to-end
```

## Configuração

### Dependências

Python 3.8+

```bash
pip install -r api/requirements.txt
```

Para desenvolvimento:
```bash
pip install -r requirements-dev.txt
```

## Uso

### 1. Testar a API

```bash
python3 test_api.py
```

Isto:
- ✓ Carrega os dados de exemplo (`data/seed.json`)
- ✓ Valida NIFs
- ✓ Consulta empresas por NIF (exemplo: 512044821)
- ✓ Pesquisa por nome/local

Saída esperada:
```
🔍 Testing company lookup...
  Found: {
    'nif': '512044821',
    'legalName': 'SOUSA & SILVA, LDA',
    'publicNames': [
      {
        'name': 'FARMÁCIA CORREA',
        'confidence': 0.85,
        ...
      }
    ]
  }
  ✓ Lookup works
```

### 2. Correr o servidor HTTP

```bash
python3 -m api.server
```

O servidor fica disponível em `http://127.0.0.1:8000`.

**Endpoints:**
- `GET /` — health check
- `GET /api/company/<nif>` — consulta empresa por NIF
- `GET /api/search?q=<termo>` — busca por nome/NIF
- `POST /api/suggestions` — submeter sugestão de nome público
- `GET /api/admin/suggestions` — listar sugestões pendentes
- `POST /api/admin/suggestions/<id>/approve|reject` — revisar sugestão

Exemplo:
```bash
curl http://127.0.0.1:8000/api/company/512044821 | jq
```

Resultado:
```json
{
  "nif": "512044821",
  "legalName": "SOUSA & SILVA, LDA",
  "publicNames": [
    {
      "name": "FARMÁCIA CORREA",
      "confidence": 0.85
    }
  ]
}
```

### 3. Frontend

Abrir `web/index.html` num browser (depois que o servidor estiver a correr).

Interface permite:
- Pesquisar empresa por NIF
- Ver nome legal + nomes públicos encontrados
- Sugerir novos nomes públicos

## Fluxo de dados

### Lookup (consulta)

```
User → Query NIF
       ↓
   Lookup(nif)
       ↓
   companies.json (memoria/BD)
       ↓
   Return: { nif, legalName, publicNames[] }
```

### Sugestão (contribuição da comunidade)

```
User → POST /api/suggestions { nif, name, source_url }
       ↓
   Validar (NIF válido, nome 2-200 chars, URL http/https)
       ↓
   Guardar em suggestions.json (status: pending)
       ↓
   Admin → Revisar
           ↓
           Approve → Add to companies.json (publicNames)
           Reject  → Marcar como rejected
```

### Descoberta automática (candidates)

```
Discovery Job → Provider (web_search, directories, ...)
                ↓
            NIF → [{"public_name": "...", "url": "...", ...}]
                ↓
            Criar Candidate (status: candidate)
                ↓
            candidates.json
                ↓
            Admin → Revisar (approve/reject)
                    ↓
                    Approve → Add to companies.json
                    Reject  → Mark rejected
```

## Desenvolvimento

### Adicionar uma nova fonte de descoberta

1. Criar ficheiro em `api/sources/` (e.g., `my_source.py`)
2. Implementar uma função provider:

```python
def my_findings(nif: str) -> Iterable[dict]:
    """Yield findings with: nif, public_name, url, source_name, source_type."""
    # Ex: query API, parse website, etc.
    yield {
        "nif": nif,
        "public_name": "Farmácia ABC",
        "url": "https://example.com/results",
        "source_name": "My Source",
        "source_type": "directory"
    }
```

3. Usar em `discovery_job.py`:

```python
from api.sources.my_source import my_findings

providers = {
    "my_source": my_findings,
}

result = run_discovery(["512044821"], providers)
```

### Executar descoberta em lote

```python
from api.discovery_job import run_discovery
from api.sources.directories import search_targets

# Mock provider para testes
def mock_provider(nif):
    yield {
        "nif": nif,
        "public_name": "Farmácia Demo",
        "url": "https://example.com",
        "source_name": "Demo",
        "source_type": "demo"
    }

result = run_discovery(["512044821"], {"demo": mock_provider})
print(result)
# → {
#   "processed_nifs": 1,
#   "findings": 1,
#   "candidates_added": 1,
#   "errors": []
# }
```

## Próximos passos

1. **Implementar web scraper real** para diretórios (Empresite, eInforma, Racius)
2. **Integrar web search** (Google Custom Search API, Bing, ou similar)
3. **Migrar de JSON para PostgreSQL** (para produção)
4. **Criar UI de admin** (atualmente apenas HTTP endpoints)
5. **Adicionar autenticação** (para revisores)
6. **Implementar cache** de resultados de web scraping
7. **Testes automatizados** com pytest

## Troubleshooting

### Importação quebrada: `ModuleNotFoundError: No module named 'api'`

Assegurar que está na pasta raiz do projeto:
```bash
cd /caminho/para/nif-nome
python3 test_api.py  # ✓ Correto
```

Não:
```bash
cd /caminho/para/nif-nome/api
python3 test_api.py  # ✗ Errado
```

### Companies database vazia

Os dados estão em `data/seed.json`. O `test_api.py` carrega-os automaticamente.
Se estiveres a usar o servidor diretamente, podes fazer seed assim:

```python
from api.repository import _read_json, _write_json, COMPANIES_FILE
import json

seed_path = Path("data/seed.json")
with open(seed_path) as f:
    seed_data = json.load(f)

companies_dict = {}
for company in seed_data.get("companies", []):
    nif = company.get("nif")
    if nif:
        companies_dict[nif] = {
            "nif": nif,
            "legalName": company.get("legal_name"),
            "publicNames": company.get("public_names", []),
        }

_write_json(COMPANIES_FILE, companies_dict)
```

## Contatos & Contribuições

Este é um projeto **comunitário e aberto**. Sinta-se livre para:
- Sugerir nomes públicos via API
- Submeter PRs com melhorias
- Relatar problemas no GitHub
