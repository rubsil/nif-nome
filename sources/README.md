# Fontes

Os adaptadores desta pasta obtêm dados externos para alimentar a base NIF → Nome.

## Regra importante

Um adaptador de identificação **não deve inventar o nome público**. Deve devolver os dados encontrados e, quando aplicável, os campos `alias`/nome comercial como dados de origem.

A associação entre NIF e nome público será posteriormente registada com a fonte e a evidência correspondente.

## NIF.pt

`nifpt.py` é o primeiro adaptador. Pode ser usado localmente:

```bash
python sources/nifpt.py 512044821
```

A resposta completa da API é impressa em JSON para facilitar a inspeção enquanto estamos a desenvolver o normalizador.
