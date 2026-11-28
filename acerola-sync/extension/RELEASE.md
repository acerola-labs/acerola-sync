# Versões da extensão

Cada versão é uma seção `## X.Y.Z · data`, escrita na `release/X.Y.Z` junto com o bump
(`node scripts/release/bump.mjs extension X.Y.Z`). O `extension-release.yml` publica essa seção como
texto da release do GitHub, com a instalação (`.github/release/extension.md`) embaixo; sem ela, a
release não sai.

## Como montar o texto da release

Quem lê é quem vai instalar a extensão. Escreva para essa pessoa, não para quem programa.

1. **Destaques**: uma a três linhas com o que mais importa nesta versão.
2. Depois, só as seções que tiverem algo, nesta ordem:
   - `### Novidades`: o que a pessoa passa a conseguir fazer.
   - `### Correções`: o que estava errado e agora funciona.
   - `### Mudanças e melhorias`: o que ficou diferente ou mais rápido.
   - `### Atenção`: o que quebra ou pede ação (atualizar o server junto, entrar de novo).
   - `### Dependências`: só quando a pessoa sente (segurança, compatibilidade).
3. Cada item numa linha, começando pelo nome da coisa em negrito: `- **Semana:** …`.
4. Fora do texto: CI, refatoração, teste, lint, docs internas e nomes de classe ou arquivo.

## 1.8.2 · 28 nov 2026

Nova forma de publicar as versões, sem mudança para quem usa.

## 1.8.1 · 28 nov 2026

Projeto no padrão Acerola atualizado, sem mudança para quem usa.

## 1.8.0 · 27 nov 2026

Aviso quando o que está planejado ganha data, adia, lança ou é cancelado.

### Novidades

- **Avisos do planejado:** ganhou data, adiou, lançou ou foi cancelado, a extensão avisa.

### Mudanças e melhorias

- **Semana** com os cards de capa da Lista e o seletor de dia embaixo.
