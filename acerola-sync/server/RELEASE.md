# Versões do server

Cada versão é uma seção `## X.Y.Z · data`, escrita na `release/X.Y.Z` junto com o bump
(`node scripts/release/bump.mjs server X.Y.Z`). O `server-release.yml` publica essa seção como texto
da release do GitHub; sem ela, a release não sai. O deploy sai pelo Komodo no merge na `main`.

## Como montar o texto da release

Quem lê é quem hospeda o server. Diga o que muda para essa pessoa, na mesma ordem da extensão
(destaques, depois `### Novidades`, `### Correções`, `### Mudanças e melhorias`, `### Atenção` e
`### Dependências`, só as que tiverem algo). Migração de banco, variável nova ou mudança no deploy
vão sempre em `### Atenção`.

## 1.6.0 · 27 nov 2026

- **Sync de hora em hora** também atualiza o que ainda não saiu, mangá planejado incluso.
