# Acerola Sync — Arquitetura

> Extensão (Chrome/Firefox) + server próprio para lista, lançamentos e tracking de anime e mangá, só com o AniList.
> Funções inspiradas no [MALSync](https://github.com/MALSync/MALSync). Visual próprio, com a paleta única e os componentes do acerola-reader.
> Licença: MPL-2.0 (a mesma do acerola-reader). Uso pessoal: uma instância, um usuário.

## 1. Princípios

1. **O Postgres é um espelho do AniList.** O sync puxa a lista inteira e guarda as obras e as entradas. Busca, lista e tela da obra saem do espelho, sem request ao AniList.
2. **Escrita vai para os dois ao mesmo tempo.** Cada mudança (+1, status, nota, tracking) vai ao AniList e ao espelho na mesma chamada. Se o AniList estiver fora, ela vale no espelho com `dirty = true` e é reenviada depois.
3. **O app funciona sem o AniList.** Com a API dele fora, a lista, a busca e o tracking continuam; o que mudou fica pendente.
4. **Tudo em UTC.** O banco usa `timestamptz` e a agenda roda em UTC. A tela mostra e recebe o horário de Brasília (UTC−3).
5. **A extensão não guarda segredo.** Ela tem só o token de sessão do server. O token do AniList fica no server, criptografado.

## 2. Visão geral

```mermaid
flowchart LR
  subgraph Browser [Navegador]
    CS[Content scripts<br/>Sakura · MangaDex · Crunchyroll · Netflix · personalizados] -->|mensagem| SW[Service worker]
    UI[Popup<br/>Svelte 5] --> API
    SW -->|HTTPS + token de sessão| API
  end
  subgraph Servidor [hetzner · Swarm do Komodo, atrás do Caddy]
    API[server<br/>Rust + axum] <--> PG[(Postgres<br/>container do config, via DATABASE_URL)]
    SCH[scheduler<br/>tokio, decide em memória] -->|só quando algo vence| PG
  end
  API -->|escrita na hora| AL[AniList GraphQL]
  SCH -->|sync agendado · reenvio de pendências| AL
```

## 3. Server (`acerola-sync/server`)

Rust + axum + sqlx, nas mesmas camadas do acerola-reader:

| Camada | O que tem |
|---|---|
| `bios` | env, pool do Postgres, `AppState`, rotas, CORS |
| `cmd` | handlers (`features`) e payloads (`events`) de cada rota |
| `core/services` | auth, entries (regras de edição), sync (espelho), schedule, search, tracking |
| `core/workers` | `scheduler`: a cada 30 s confere a agenda e a cada 5 min as pendências, lendo só o `scheduler_state` (memória); vai ao banco só quando um sync vence ou há pendência |
| `data` | models e repositories (SQL explícito) |
| `infra` | cliente do AniList, crypto, migrations, erros |

### 3.1 Cliente do AniList

- Fila única no processo: no máximo **30 req/min** (um terço do limite normal de 90, e igual ao limite quando o AniList está degradado).
- Em 429, lê o `Retry-After` e pausa todas as chamadas.
- Falha passageira (rede, 5xx, 429) não vira erro para o usuário: a escrita fica pendente.

### 3.2 Sync (espelho)

Cada query pede só o que a tela usa (`infra/anilist/queries.rs`):

| Query | Campos | Quando |
|---|---|---|
| `LIST_MEDIA_FIELDS` | título, capa `large`, total, status, próximo episódio | lista, incremental, busca, +1 |
| `DETAIL_MEDIA_FIELDS` | + sinopse, banner, gêneros, capa `extraLarge` | uma vez por obra, ao abrir (`details_synced_at`) |
| `airing_by_ids` | só o próximo episódio | incremental, 50 obras por request |

A query leve não apaga o que o detalhe trouxe: sinopse, banner, gêneros, temporada e país usam `COALESCE` no upsert.

**Modos:**
- **Incremental** (padrão): `Page.mediaList(sort: UPDATED_TIME_DESC)` de 50 em 50, parando na primeira entrada que não mudou desde o último pull (com 5 min de folga). Depois atualiza o próximo episódio do que está em lançamento. Normalmente custa **2 requests**. Passou de 20 páginas, vira completo.
- **Lista inteira**: `MediaListCollection` de anime e de mangá, em pedaços de 500, e remove do espelho o que sumiu do AniList. Roda no primeiro login, quando pedido (`POST /sync?full=true`) ou se o último completo tem mais de 24 h.

Passos de qualquer sync:
1. Envia as entradas `dirty` (o que mudou aqui com o AniList fora).
2. Puxa conforme o modo. O que ainda está pendente nunca é sobrescrito nem apagado.
3. Cada passo vira uma linha em `sync_logs`; a tela acompanha ao vivo.
4. Grava o resultado em `sync_runs`, com o modo e quantos requests ao AniList foram feitos.

Um sync por vez (`sync_lock`). O `POST /sync` responde **202** na hora e roda em segundo plano; a tela lê `/sync/runs/{id}/logs?after=` a cada 800 ms.

### 3.3 Agenda

- `sync_settings.schedule_times` é uma lista de horários `TIME` em UTC. A tela converte de/para o horário de Brasília.
- Cada horário roda uma vez (`last_scheduled_slot`). Se o server ficou fora no horário, roda uma vez ao voltar, não uma por horário perdido.
- Salvar a agenda não dispara sync na hora: o horário que já passou hoje conta como atendido.
- **O worker decide em memória** (`core/workers/scheduler_state.rs`): por usuário, horários, último horário atendido, intervalo do automático, início do último sync e se há entrada pendente. Carrega tudo do banco no boot e no login, e quem muda um desses fatos atualiza o `state.scheduler` (rotas de agenda e intervalo, `prepare` do sync, `save` e `push_pending` das entradas). Antes, o tick de 30 s fazia duas ou três consultas e um Postgres cobrado por tempo ligado (Neon) nunca dormia. Vale para uma instância só: com duas réplicas cada uma teria o seu mapa (as escritas continuam no banco, então o pior caso é um sync repetido, que o `sync_lock` e o `Conflict` absorvem).

### 3.4 Semana (temporada e dias)

- `GET /releases/week` serve do espelho. Para anime, antes confere `season_pulls`: a primeira vez puxa a temporada atual (`Page.media(season, seasonYear, sort: POPULARITY_DESC)`, 3 páginas de 50) e espera; passado um dia, serve o que tem e atualiza em segundo plano. A temporada vem do calendário de Brasília (`releases::current_season`).
- A query leve (`LIST_MEDIA_FIELDS`) passou a pedir `season`, para a temporada ficar no espelho.
- O dia de mangá (e de anime sem horário) é escolhido pela pessoa e fica em `release_days`; a tela decide o dia (escolhido → AniList → nenhum).

### 3.5 Tracking

1. **Resolver** (`POST /track/resolve`): qual obra do AniList é a página do site. Ordem: mapeamento salvo → ID informado pelo site (o MangaDex informa) → título no espelho (pg_trgm, similaridade ≥ 0,75) → busca no AniList (1 request). O resultado fica em `site_mappings`.
2. **Correção manual** (`PUT /track/mapping`): grava com `source = MANUAL`, que a busca automática nunca sobrescreve.
3. **Marcar** (`POST /track/progress`), com as regras do MALSync:
   - nunca diminui o progresso;
   - não mexe em obra concluída;
   - planejado, pausado ou largado vira "assistindo/lendo";
   - chegar no total conclui e preenche as datas (dia de Brasília).
4. Toda mudança de progresso entra em `history`, com a origem (site ou manual) e a URL.

### 3.6 Banco

| Tabela | Chave | Conteúdo |
|---|---|---|
| `users` | `id` (AniList) | nome, avatar, token do AniList (`cipher` + `nonce`, AES-256-GCM) |
| `sessions` | `id` | `user_id`, `token_hash` (SHA-256), dispositivo, `revoked_at` |
| `media` | `id` (AniList) | títulos, sinônimos, capa, total, status, próximo episódio, `search_text` (índice trigram), `details_synced_at` |
| `entries` | `(user_id, media_id)` | status, progresso, nota (0–100), datas, `dirty`, `push_attempts`, `last_push_error` |
| `sync_settings` | `user_id` | `schedule_enabled`, `schedule_times` (UTC), `last_scheduled_slot`, `last_pull_at`, `last_full_sync_at` |
| `sync_runs` | `id` | gatilho, modo, status, contagens, requests ao AniList, erro |
| `sync_logs` | `id` | linha a linha de cada sync (nível, mensagem, hora) |
| `site_mappings` | `(user_id, site, identifier)` | `media_id`, `source` (`AUTO`/`MANUAL`) |
| `history` | `id` | progresso anterior → novo, origem, URL |
| `custom_sites` | `id` | match pattern, regex da URL, seletor do título |
| `season_pulls` | `(season, season_year)` | quando a lista da temporada foi puxada do AniList (uma vez por dia) |
| `release_days` | `(user_id, media_id)` | dia da semana escolhido à mão (0 = domingo … 6 = sábado, Brasília) |

### 3.7 API

Todas as rotas, menos `/health`, `/auth/config` e `/auth/login`, exigem `Authorization: Bearer <token de sessão>`. Erros seguem `{ errorType, message }`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | status e versão |
| GET | `/auth/config` | Client ID do AniList (público, vem do `.env`) |
| POST | `/auth/login` | `{ accessToken }` do AniList → `{ sessionToken, user }` |
| POST | `/auth/logout` | revoga a sessão |
| GET | `/me` | perfil |
| GET | `/entries?mediaType=&status=&limit=&offset=` | lista do espelho com as obras, paginada (48 por vez, máx. 200) |
| GET | `/entries/counts` | quantas entradas por tipo e status (abas da lista) |
| PATCH / DELETE | `/entries/{mediaId}` | edita ou remove (AniList + espelho) |
| GET | `/media/search?q=&mediaType=&remote=` | busca no espelho; AniList só com `remote=true` ou sem resultado |
| GET | `/media/{id}` | obra + entrada; busca o detalhe no AniList uma vez só |
| GET | `/releases/week?mediaType=` | a semana: animes da temporada e o que você acompanha (ou mangás em leitura), com o dia escolhido |
| PUT | `/releases/{mediaId}/day` | `{ weekday }` 0–6 escolhe o dia; `null` volta ao horário do AniList |
| POST | `/sync?full=` | começa um sync (202); `full=true` força a lista inteira |
| GET | `/sync/status` | agenda, últimos syncs, pendências |
| GET | `/sync/runs/{id}/logs?after=` | o sync e as linhas de log depois de `after` |
| PUT | `/sync/schedule` | `{ enabled, times: ["12:00:00"] }` em UTC |
| POST | `/track/resolve` · `/track/progress` | tracking |
| PUT / DELETE | `/track/mapping` | correção manual |
| GET | `/history?limit=` | histórico |
| GET/POST/PUT/DELETE | `/custom-sites[/{id}]` | sites personalizados (a regex é validada no server) |

### 3.8 Login e uso pessoal

- O Client ID do app do AniList fica no `.env` do server (`ANILIST_CLIENT_ID`). A extensão só sabe o endereço do server e pede o Client ID em `/auth/config`.
- A extensão faz o OAuth do AniList em **implicit grant** (`response_type=token`), como o AniMouto, via `browser.identity.launchWebAuthFlow`. O Client Secret não é usado.
- O token vai ao server, que confere de quem é (`Viewer`), guarda criptografado e devolve um token de sessão aleatório. No banco fica só o hash.
- Instância de uma pessoa: o primeiro login vira o dono. Outro usuário do AniList recebe 403. `ALLOWED_ANILIST_USER_ID` trava explicitamente.

### 3.9 Variáveis de ambiente

O pool do Postgres roda **sem cache de statements preparados** (`statement_cache_capacity(0)`): atrás de um pooler (pgbouncer), um statement preparado sobrevive ao restart e quebra depois de uma migration (`cached plan must not change result type`).


| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Postgres |
| `ENCRYPTION_KEY` | sim | 32 bytes em base64 (`openssl rand -base64 32`) |
| `ANILIST_CLIENT_ID` | sim | Client ID do app no AniList; a extensão lê em `GET /auth/config` |
| `SERVER_PORT` | não (3010) | porta |
| `ALLOWED_ANILIST_USER_ID` | não | trava a instância num usuário |
| `ANILIST_API_URL` | não | só para teste |

## 4. Extensão (`acerola-sync/extension`)

WXT + Svelte 5, com os componentes e temas do acerola-reader.

### 4.1 Interface

A mesma interface roda em dois modos (`lib/screens/app-shell.svelte`):
- **Popup** (440×600): barra em pílula flutuando embaixo.
- **Página cheia** (`app.html`, botão "Abrir em aba"): barra em pílula no topo, blocos de números e a obra abrindo num painel à direita.

Telas:
- **Lista:** as palavras "Anime" e "Mangá" grandes são as abas de tipo. Abas por status com contagem (assistindo, completo, planejado, pausado, largado), como o MALSync. A última obra mexida vira o destaque "Continuar" com o +1 grande. Cards com selos de progresso, atraso e próximo episódio.
- **Semana:** o que sai em cada dia, no horário de Brasília, de hoje em diante, nos mesmos cards de capa da Lista (`acerola-release-card`, com o horário do episódio como selo e o seletor de dia embaixo). Anime pelo horário do AniList (`next_airing_at`), em "Minha lista" ou na "Temporada" inteira (o server espelha os 150 animes mais populares da temporada uma vez por dia; a tela não gasta request). Mangá, e anime sem horário, ficam em "Sem dia definido" até você escolher o dia (`release_days`); o dia escolhido vence o do AniList. Regras de dia e agrupamento em `lib/utils/week.utils.ts`.
- **Obra:** banner, números (média, total, próximo episódio), status em fichas, progresso com +/−, nota e sinopse.
- **Buscar:** espelho primeiro; o botão "Buscar também no AniList" gasta 1 request.
- **Sync:** estado do último sync, botões "Sincronizar agora" e "Lista inteira", **logs ao vivo**, agenda (Brasília, com o UTC ao lado), syncs anteriores e o histórico do que foi marcado.
- **Ajustes:** conta, modo claro/escuro, sites (liga/desliga), tempo no capítulo e sites personalizados.

Ao abrir o popup numa página de obra ou capítulo de um site rastreado, o topo da lista mostra **essa obra** (o content script responde `page:current`). Se ela não foi achada, o botão "Vincular" abre a busca.

Visual: paleta única do acerola-reader (`theme/colors/catppuccin.css`, só claro/escuro), tipografia grande e pesada, blocos de cor `*-soft` e **nenhuma borda colorida**. Animações com GSAP (`lib/utils/motion.utils.ts`): entrada em cascata dos cards, contagem dos números, pílula que desliza entre as abas, "pulo" do +1 e linhas de log entrando. Quem pede menos movimento no sistema não vê animação. As regras de design (só tokens de cor, raio e sombra; nenhuma borda colorida) estão na skill `.claude/skills/acerola-design` e são conferidas por `scripts/design/check-design.mjs` (pre-commit do lefthook, CI e hook do Claude Code).

### 4.2 Tracking (estilo MALSync)

| Site | Tipo | Como lê | Gatilho |
|---|---|---|---|
| Sakura Mangás | mangá | URL `/obras/<slug>/<cap>/` + `#id-titulo` | N s no capítulo (padrão 10) |
| MangaDex | mangá | API `chapter/<id>?includes[]=manga` (traz o ID do AniList) | N s no capítulo |
| Crunchyroll | anime | JSON-LD `TVEpisode`, com o DOM como alternativa | 85% do vídeo |
| Netflix | anime | título do player (`T1:E5`) | 85% do vídeo, só se já está na lista ou foi vinculado |
| Personalizado | ambos | regex na URL com `(?<id>)`, `(?<progress>)` e `(?<title>)` opcional | conforme o tipo |

- Os content scripts não falam com o server: mandam mensagem ao background, que tem a sessão.
- Um aviso pequeno (shadow DOM) mostra "Detectado", "Marcado" ou "Não achei". O botão **Vincular manualmente** abre a tela de busca para corrigir o mapeamento.
- Sites personalizados usam `optional_host_permissions`: a permissão do domínio é pedida ao salvar, e o background registra o script com `scripting.registerContentScripts`.
- O número do capítulo/episódio do site personalizado sai da URL (grupo `progress`) ou, no modo avançado, da página: título (`document.title`) ou um elemento (seletor CSS), com uma regex opcional (`progress_source`, `progress_selector`, `progress_pattern`). Em SPA, número igual ao da página anterior só vale depois de se repetir, porque a URL troca antes do HTML. A tela sugere onde o número parece estar ("Cap. 30" no título, no `h1` ou no seletor de capítulos), mas só marca com a regra confirmada.
- Nada de código copiado do MALSync (GPL-3.0): as regras foram reescritas aqui, em MPL-2.0.

### 4.3 Avisos (background)

O service worker confere o espelho a cada 15 min (`browser.alarms`), ao abrir o navegador e quando o popup fecha, e compara com o que viu na última vez (`lib/services/airing.service.ts`; estado em `storage`). Nenhum request ao AniList: o server já mantém `next_airing_at` e o status em dia (sync automático de hora em hora, que atualiza anime no ar e tudo que ainda não saiu, mangá planejado incluso).

| Aviso | Para | Dispara quando | Chave no `storage` |
|---|---|---|---|
| Episódio novo (e o número no ícone) | anime em "assistindo" ou "revendo" | o último episódio lançado passa do que foi visto e do seu progresso | `airingSeen` |
| Ganhou data | planejado, ainda não lançado | `nextAiringEpisode` 1 ganha `airingAt` | `plannedSeen` |
| Adiado | planejado | a estreia fica mais de 1 h depois da última vista, ou o status vira `HIATUS` | `plannedSeen` |
| Lançou | planejado (anime e mangá) | status vira `RELEASING`, ou a hora da estreia passou | `plannedSeen` |
| Cancelado | planejado | status vira `CANCELLED` | `plannedSeen` |

A primeira olhada só monta a base, sem avisar o acumulado. Cada aviso vai pelo sistema (`browser.notifications`, clicar abre a obra) e fica na tela de Notificações (`notifications`, os 50 últimos; o sino mostra os não lidos). Ids: `airing:{mediaId}:{ep}`, `dated:{mediaId}:{data}`, `delayed:{mediaId}:{data}`, `released:{mediaId}`, `cancelled:{mediaId}`.

## 5. Deploy

`acerola-sync/server/.config/docker/compose.yml` sobe só o `server`. O Postgres é externo e vem do `DATABASE_URL` do `.env`. Em produção ele é o container `postgres` do repositório `config` (Komodo Deployment no hetzner, `configuration/apps/postgres`), na mesma rede `edge` da stack e sem porta publicada: `postgres://acerola_sync:…@postgres:5432/acerola_sync`. Banco e usuário são criados pelo script de init daquele app, a partir da Variable `ACEROLA_SYNC_DB_PASSWORD`; o backup diário (`pg_dumpall`, 14 dias) fica em `/opt/postgres/backups` no servidor. TLS e domínio ficam no Caddy do servidor. O endereço do server é configurado na extensão (ex.: `https://api.sync.acerola.app`), e a extensão não precisa saber onde ele roda.

## 6. Testes

- Server: `cargo test` roda as regras puras (tracking, agenda, edição, crypto). Os fluxos completos (login, espelho, AniList fora, tracking, agenda) precisam de `TEST_DATABASE_URL=postgres://user:pass@host:port/postgres` e simulam o AniList com wiremock. Cada teste cria e apaga o próprio banco.
- Server, repositórios: cada `data/repositories/*.rs` tem o seu `mod tests` (regra do acerola-reader), com um banco novo por teste criado por `infra/db/test_support.rs` a partir do mesmo `TEST_DATABASE_URL`.
- Extensão: `npm test` (componentes, telas, adapters, cliente da API, horários, animações) e `npm run test:e2e` (popup e página cheia em Chromium headless, com o server simulado). Todo componente em `lib/components/` tem `.svelte` + `.test.ts` + `.stories.svelte`.
- `npm run test:storybook` está quebrado desde antes desta mudança: o Rolldown (Vite 8) falha ao otimizar componentes Svelte (`'new.target' can only be used in functions`).

## 7. Pendências

- [ ] **Cache das capas no R2.** Hoje `cover_url` aponta para o CDN do AniList.
- [ ] Validar Crunchyroll e Netflix nos sites de verdade. Os seletores foram escritos a partir do MALSync e do HTML conhecido, e só foram testados com HTML de exemplo.
- [ ] Domínio final do server (`sync.acerola.app` ou outro).
- [ ] Firefox: cadastrar também o redirect `*.extensions.allizom.org` no app do AniList.
- [ ] Notificações do AniList (o AniMouto tem). O badge com episódios atrasados e os avisos locais já existem (seção 4.3).

## Release e deploy

Tags por app, `<app>/vX.Y.Z` (desvio do padrão Acerola, que usa uma tag `vX.Y.Z` por repositório: aqui os dois apps têm versões próprias). Pré-versão é `<app>/vX.Y.Z-rc.N` e sai como pré-lançamento. O workflow recusa tag fora da `main`.

| Tag | Workflow | O que faz |
|---|---|---|
| `extension/v1.2.0` | `.github/workflows/extension-release.yml` | Sobe a versão do `extension/package.json`, testa, gera os `.zip` de Chrome e Firefox, devolve o commit `[build](extension): Versão …` para `main` e `develop` e publica o Release (pré-lançamento numa tag `-rc.N`). |
| `server/v1.2.0` | `.github/workflows/server-release.yml` | Só sobe a versão do `server/Cargo.toml`/`Cargo.lock` e devolve o commit `[build](backend): Versão …` para `main` e `develop`. Sem Release, sem imagem. |

O bump é o `scripts/release/bump.mjs` (testado em `npm run test:release`). O commit do bot vai para
a `main` e a `develop` com o `GITHUB_TOKEN` do próprio job (`contents: write`; os hooks do lefthook
não rodam no CI). Para republicar uma tag, **Actions → Release/… → Run workflow** com a tag no
campo `tag`: o workflow lê a tag informada em vez da do push.

Testes: `Tests/Extension` (`extension-tests.yml`: prettier, design, i18n, tipos, testes e build) e
`Tests/Server` (`server-tests.yml`: fmt, clippy e testes) rodam em push e PR na `develop` e na `main`.

**Deploy do server** (Komodo, `.komodo/` na raiz): a cada push na `main` o webhook do GitHub
dispara a Procedure `hetzner_acerola-sync`: Pull do repo no hetzner, Build da imagem no próprio hetzner
(sem registry, tag `<commit>-hetzner`) e Deploy da Stack no Swarm do servidor. O `komodo.sh`
confere a imagem e o `route.sh` grava `api.sync.acerola.app` no Caddy do servidor
(`conf.d/hetzner_acerola-sync.caddy`, rede `edge`). A Action `hetzner_acerola-sync_rollback` volta
a versão anterior.

No GitHub:

- **Repositório** (secret): `EXTENSION_KEY`, a chave privada RSA da extensão. O release tira dela
  a pública e põe no `key` do manifest: é daí que sai o id fixo da extensão (o mesmo em qualquer
  PC, e o retorno do login do AniList depende dele). A mesma chave fica no 1Password, item
  "ACEROLA SYNC EXTENSION KEY", que o `mise run build:extension` usa no build local.
- **Webhooks**: o da Sync `acerola-sync` e o da Procedure `hetzner_acerola-sync` do Komodo, no push.

No Komodo, as Variables secretas `ACEROLA_SYNC_DATABASE_URL` e `ACEROLA_SYNC_ENCRYPTION_KEY`, mais
`ACEROLA_SYNC_DB_PASSWORD`, que o Postgres do `config` usa para criar o usuário `acerola_sync`
(é a mesma senha que vai dentro da `ACEROLA_SYNC_DATABASE_URL`).
Os valores de desenvolvimento ficam no `server/.env` local (fora do git).
