---
name: acerola-git
description: Padrão de git e GitHub de todo projeto Acerola — commit [tipo](local): Mensagem, Git-Flow (main, develop, feature/, bugfix/, release/, hotfix/), travas de branch, lefthook, PR, issues, Actions (nomes, gatilhos, deploy), Dependabot e release com tag. Use ao commitar, criar branch, juntar branch, abrir PR ou issue, criar ou mudar workflow, e ao preparar release.
---

# Git e GitHub Acerola

Igual em todo projeto, independente da linguagem. Os hooks (lefthook) travam o que dá para travar.

## 1. Commit

```
[tipo](local): Mensagem
```

- **tipo**: `feat` · `fix` · `refactor` · `test` · `docs` · `style` · `perf` · `build` · `ci` ·
  `chore` · `merge`.
- **local**: os de `acerola.config.json` (`commit.scopes`), em inglês. Um local por commit: tocou dois, são
  dois commits. Nunca `[feat](site,kit)`.
- **Mensagem**: português, primeira letra maiúscula, sem ponto final, até 100 caracteres. Diz o
  que a mudança **faz**, não onde mexeu.
- Corpo opcional com o porquê; rodapé `Refs: #123` e `BREAKING CHANGE: …`.
- Merge sempre com `-m` no formato: `[merge](site): Hero em pôster com Titan One`.
- Commit assinado (SSH) quando a máquina tem chave; nunca desligar a assinatura para passar.
- Conferido por `scripts/git/commit-msg.mjs` no hook `commit-msg`.

## 2. Branches (Git-Flow)

| Branch | Para | Regra |
|---|---|---|
| `main` | produção | só quem administra faz merge e push |
| `develop` | integração | só recebe merge; nada de commit direto |
| `feature/<nome>` | funcionalidade | sai da `develop`, volta para a `develop` |
| `bugfix/<nome>` | correção não urgente | sai da `develop`, volta para a `develop` |
| `release/<versão>` | preparar versão | sai da `develop`, vai para `main` e `develop` |
| `hotfix/<versão>` | correção em produção | sai da `main`, vai para `main` e `develop` |

- Nome em kebab-case e **em inglês** (ninguém de fora vê branch): `feature/hero-titan`,
  `bugfix/favicon-foreground`, nunca `feature/tela-de-lista`. Prefixo `feature/`, nunca `feat/`.
- 🔒 **Só três branches vivas: `main`, `develop` e a de trabalho do momento.** Juntou, apaga na
  hora, local e remota (`git branch -d <nome>` e `git push origin --delete <nome>`). Nenhuma
  `feature/`, `bugfix/`, `release/` ou `hotfix/` fica parada depois do merge. Só se mantém outra
  branch quando quem administra pede, de forma específica, por aquela branch.
- Tag de versão `vX.Y.Z` (semver) na `main`: regras na seção 2.1.
- `scripts/git/branch-guard.sh` trava commit na `main`/`develop` e push na `main`. Quem
  administra libera a própria máquina: `git config project.admin true`.

## 2.1 Tags 🔒

A `main` só recebe o merge da `release/X.Y.Z` (ou `hotfix/X.Y.Z`), e é esse merge que publica: o
Komodo faz o deploy pelo webhook da Procedure no push da `main` (seção 5). A tag marca a versão
nesse mesmo merge e cria a release do GitHub (`<local>-release.yml`). Push na `develop` ou em branch
de trabalho nunca publica.

| Tag | Formato | Release do GitHub? |
|---|---|---|
| Versão | `vMAJOR.MINOR.PATCH` (`v1.4.2`) | sim |
| Pré-versão | `vX.Y.Z-rc.N` (`v1.5.0-rc.1`) | não: só para testar a release |

- Sempre com `v` minúsculo e os três números, sem zero à esquerda (`v1.4.2`, nunca `1.4.2`,
  `v1.4`, `V1.4.2` ou `v01.4.2`). Sem nome de local: a tag vale para o repositório.
- **MAJOR** quebra quem usa (token renomeado, componente removido, API diferente); **MINOR**
  acrescenta sem quebrar; **PATCH** só corrige. Antes da `v1.0.0`, MINOR pode quebrar.
- Só nasce no commit de merge da `release/X.Y.Z` (ou `hotfix/X.Y.Z`) na `main`, **anotada**.
- 🔒 **A mensagem da tag é uma mensagem, não um commit.** Diz em português, para quem usa, o que a
  versão traz: `Versão X.Y.Z: <o que muda, numa frase>` (`git tag -a v1.4.2 -m "Versão 1.4.2:
  cards clicáveis e o logo de cada app"`). Nunca `[tipo](local): …`: esse formato é do commit de
  merge (`[merge](local): Versão X.Y.Z`), não da tag.
- O número é o mesmo do manifesto (`package.json`, `Cargo.toml`, Gradle). O workflow recusa tag
  fora da `main` ou diferente do manifesto.
- Tag publicada não se move nem se apaga. Saiu errado? Corrija e lance a próxima PATCH.

## 3. Hooks (lefthook)

`lefthook.yml` é o mesmo em todo projeto:

| Hook | Faz |
|---|---|
| `commit-msg` | `commit-msg.mjs`: formato, tipo e local |
| `pre-commit` | `branch-guard.sh commit` + `check-design.mjs` nos arquivos de interface + `check-i18n.mjs` nas mensagens |
| `pre-merge-commit` | `branch-guard.sh merge` |
| `pre-push` | `branch-guard.sh push` |

Instalação: `node scripts/git/setup-git.mjs` (grava o Git-Flow, o template e roda `lefthook install`).

## 4. GitHub

- `.github/CODEOWNERS` com dono por pasta de app.
- `ISSUE_TEMPLATE/`: `bug_report.md` e `feature_request.md`, título `[bug](local): …`,
  `blank_issues_enabled: false`.
- `PULL_REQUEST_TEMPLATE.md`: o que muda, como testar, prints claro/escuro, checklist.
- PR para a `develop`, um local por PR (salvo mudança de fato compartilhada), título no formato do
  commit. Merge com squash proibido: o histórico das features fica.
- Labels por local e por tipo (`dependencies`, `bug`, `feature`).

## 5. Actions

- Um workflow por local e por função: `<local>-tests.yml` e `<local>-release.yml` (e
  `<local>-deploy.yml` só para o que não roda no Komodo, como Storybook no Cloudflare). Nome visível
  `Tests/<Local>`, `Release/<Local>`, `Deploy/<Local>`.
- Gatilho de teste: `push` e `pull_request` em `develop` e `main`, com `paths` do local e do próprio
  workflow; `workflow_dispatch` sempre.
- Release (e deploy fora do Komodo): **só** `push` de tag de versão,
  `tags: ['v[0-9]+.[0-9]+.[0-9]+']` (pré-versão não casa e não publica), mais `workflow_dispatch`
  para republicar uma tag. O primeiro passo confere que a tag está na `main` e bate com o
  manifesto. `concurrency` para não sobrepor.
- Ordem dos passos: checkout → setup da linguagem com cache → instalar → lint → check/tipos →
  design → i18n → testes → build → publicar. Se algo falha, nada é publicado.
- Nome de job, step e arquivo de workflow em inglês (`name: Upload files to R2`).
- Segredo só em `secrets`; endereço e nome em `vars`. Passo opcional (ex.: R2) usa
  `if: ${{ vars.X != '' }}` para o workflow rodar sem ele.
- 🔒 **Só actions da GitHub (`actions/*`), fixadas por SHA** com a major em comentário:
  `uses: actions/checkout@<sha> # v7`. A organização `acerola-labs` recusa qualquer outra (o
  workflow nem inicia). Toolchain pelo próprio runner (`rustup`, `apt`), release com `gh`. O
  Dependabot atualiza o SHA.
- `<local>-release.yml` cria a release do GitHub da tag, com o título `Versão X.Y.Z` e as notas da
  seção da versão no `RELEASE.md` (`node scripts/release/release-notes.mjs X.Y.Z`).
- 🔒 **Deploy pelo Komodo, com dois webhooks no GitHub de cada app** (JSON, evento `push`, o
  segredo de webhook do Komodo):
  - o da Sync, `https://komodo.vinicius-gpl.com/listener/github/sync/<id da sync>/sync`, que
    aplica o `.komodo/komodo.toml`;
  - o da Procedure, `https://komodo.vinicius-gpl.com/listener/github/procedure/<servidor>_<app>/main`,
    que faz Pull → Build → Deploy. No `komodo.toml`, a Procedure fica com `webhook_enabled = true`.
  Build e Stack não têm webhook: quem chama os dois é a Procedure.

## 6. Dependabot

Semanal, na `develop`, agrupado, com o prefixo do padrão para passar no hook:
`commit-message.prefix: "[chore](deps)"` (ou `[chore](ci)` para actions).

## 7. Release

1. `release/X.Y.Z` a partir da `develop`; versão nos manifestos (`package.json`, `Cargo.toml`, Gradle).
2. `RELEASE.md` com o que mudou, para quem usa.
3. Merge na `main` e na `develop` (`[merge](local): Versão X.Y.Z`). O push na `main` dispara o
   webhook da Procedure: o Komodo faz o deploy.
4. Tag anotada `vX.Y.Z` no merge da `main`, com a mensagem da versão (seção 2.1), e
   `git push origin vX.Y.Z`.
5. A tag dispara o `<local>-release.yml`, que cria a release do GitHub.
6. Apaga a `release/X.Y.Z`, local e remota (seção 2): sobram só `main` e `develop`.
