# Modelo de dados

## Empresa

`companies` guarda a identidade jurídica e dados básicos da entidade associada ao NIF/NIPC.

## Nome público

`public_names` permite vários nomes por NIF. Isto é deliberado: uma empresa pode operar vários estabelecimentos ou usar mais do que uma marca.

`name_type` pode evoluir para valores como:

- `commercial` — designação comercial/nome pelo qual o negócio é conhecido;
- `establishment` — nome específico de estabelecimento;
- `brand` — marca;
- `alias` — nome alternativo encontrado numa fonte.

## Evidência

Cada nome deve poder ser ligado a uma fonte através de `name_evidence`. Não basta guardar apenas o resultado: queremos saber **de onde veio** e quando foi recolhido.

## Confiança

A confiança não deve ser confundida com uma verdade jurídica. É uma medida operacional da qualidade da correspondência.

Futuro modelo sugerido:

- fonte oficial / registo: confiança elevada;
- várias fontes públicas independentes: elevada;
- website oficial da empresa: elevada;
- uma única fonte de diretório: média;
- contribuição de utilizador sem fonte: baixa até confirmação;
- confirmação de vários utilizadores: aumenta a confiança.

## Privacidade

Não guardar dados pessoais dos utilizadores para uma simples contribuição. O projeto deve privilegiar dados empresariais e evidência pública.
