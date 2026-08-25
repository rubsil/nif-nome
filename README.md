# NIF → Nome

Base comunitária para associar NIF/NIPC de empresas em Portugal ao nome pelo qual são conhecidas pelo público.

## Objetivo

Quando um extrato bancário ou o e-Fatura mostra apenas a denominação social (por exemplo `SOUSA & SILVA, LDA`), permitir descobrir rapidamente o estabelecimento/marca conhecida pelo consumidor (por exemplo **Farmácia Correa**).

## Princípios

- A denominação social e o nome público são dados diferentes.
- Cada associação deve indicar a(s) fonte(s) e a data de verificação.
- A base pode combinar fontes públicas e contribuições da comunidade.
- Não assumir que um nome comercial é juridicamente a denominação da empresa.
- Permitir múltiplos nomes/estabelecimentos por NIF quando aplicável.

## Estrutura inicial

- `database/schema.sql` — modelo de dados.
- `sources/` — adaptadores para fontes externas.
- `docs/` — decisões e documentação do projeto.

## Primeiro caso de teste

`512044821` → `SOUSA & SILVA, LDA` → `FARMÁCIA CORREA`

Este caso serve como exemplo de validação do conceito; as fontes e o nível de confiança deverão ser registados na base de dados.

## Estado

🚧 Projeto em fase inicial — modelo de dados e recolha de fontes em desenvolvimento.
