# Fontes externas

Os adaptadores de fontes estão separados da publicação da base.

Fluxo:

1. Uma API, crawler ou operador recolhe um resultado público.
2. `api/sources/importer.py` valida e normaliza o finding.
3. O resultado é transformado num `candidate`.
4. O candidato entra na fila de revisão.
5. Só após aprovação pode ser publicado.

Não são feitos bypasses de autenticação, paywalls, robots.txt ou termos de utilização.

Fontes atualmente modeladas:

- Racius
- eInforma
- Empresite
