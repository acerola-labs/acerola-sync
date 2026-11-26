-- Agenda da semana (tela "Semana").
--
-- `season_pulls` lembra quando a lista de animes da temporada foi puxada do AniList: uma vez
-- por dia, e o espelho serve o resto.
CREATE TABLE season_pulls (
    season       TEXT        NOT NULL CHECK (season IN ('WINTER', 'SPRING', 'SUMMER', 'FALL')),
    season_year  INTEGER     NOT NULL,
    pulled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season, season_year)
);

-- Dia da semana escolhido à mão para uma obra (0 = domingo … 6 = sábado, no horário de
-- Brasília). O AniList só tem horário de episódio de anime; mangá, e anime sem horário, entram
-- aqui. Quando existe, vale sobre o horário do AniList.
CREATE TABLE release_days (
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_id    BIGINT      NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    weekday     SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);
