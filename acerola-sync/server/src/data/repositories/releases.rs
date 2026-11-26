use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::{
    data::{
        models::release::{ReleaseDay, ReleaseItem},
        repositories::{entries as entry_repository, media as media_repository},
    },
    infra::error::DbError,
};

/// Statuses that put a media on the user's week.
const FOLLOWED_ANIME: &str = "('CURRENT', 'REPEATING', 'PLANNING', 'PAUSED')";
const FOLLOWED_MANGA: &str = "('CURRENT', 'REPEATING')";

pub async fn season_pulled_at(
    pool: &PgPool, season: &str, year: i32,
) -> Result<Option<DateTime<Utc>>, DbError> {
    let row: Option<(DateTime<Utc>,)> =
        sqlx::query_as("SELECT pulled_at FROM season_pulls WHERE season = $1 AND season_year = $2")
            .bind(season)
            .bind(year)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(at,)| at))
}

pub async fn mark_season_pulled(pool: &PgPool, season: &str, year: i32) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO season_pulls (season, season_year, pulled_at) VALUES ($1, $2, now())
         ON CONFLICT (season, season_year) DO UPDATE SET pulled_at = now()",
    )
    .bind(season)
    .bind(year)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn save_day(
    pool: &PgPool, user_id: i64, media_id: i64, weekday: i16,
) -> Result<ReleaseDay, DbError> {
    Ok(sqlx::query_as(concat!(
        "INSERT INTO release_days (user_id, media_id, weekday) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, media_id) DO UPDATE SET
             weekday = EXCLUDED.weekday, updated_at = now()
         RETURNING ",
        release_day_columns!("")
    ))
    .bind(user_id)
    .bind(media_id)
    .bind(weekday)
    .fetch_one(pool)
    .await?)
}

pub async fn clear_day(pool: &PgPool, user_id: i64, media_id: i64) -> Result<(), DbError> {
    sqlx::query("DELETE FROM release_days WHERE user_id = $1 AND media_id = $2")
        .bind(user_id)
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// What the week screen shows for one type.
///
/// Anime: the current season (`season`/`year`) with an airing time, plus every airing anime
/// the user follows (even with no time, so a day can be chosen). Manga: the releasing ones the
/// user is reading. Ordered by the next airing time, then title.
pub async fn week(
    pool: &PgPool, user_id: i64, media_type: &str, season: &str, year: i32,
) -> Result<Vec<ReleaseItem>, DbError> {
    let sql = if media_type == "ANIME" {
        format!(
            "SELECT media.id, release_days.weekday
             FROM media
             LEFT JOIN entries ON entries.media_id = media.id AND entries.user_id = $1
             LEFT JOIN release_days
                    ON release_days.media_id = media.id AND release_days.user_id = $1
             WHERE media.media_type = 'ANIME'
               AND media.status IN ('RELEASING', 'NOT_YET_RELEASED')
               AND ((media.season = $2 AND media.season_year = $3
                     AND media.next_airing_at IS NOT NULL)
                    OR entries.status IN {FOLLOWED_ANIME})
             ORDER BY media.next_airing_at NULLS LAST, media.title_user_preferred"
        )
    } else {
        format!(
            "SELECT media.id, release_days.weekday
             FROM media
             JOIN entries ON entries.media_id = media.id AND entries.user_id = $1
             LEFT JOIN release_days
                    ON release_days.media_id = media.id AND release_days.user_id = $1
             WHERE media.media_type = 'MANGA'
               AND media.status = 'RELEASING'
               AND entries.status IN {FOLLOWED_MANGA}
               AND $2 = $2 AND $3 = $3
             ORDER BY media.title_user_preferred"
        )
    };
    // Only constants are interpolated (the status lists); values go through bind.
    let rows: Vec<(i64, Option<i16>)> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(user_id)
        .bind(season)
        .bind(year)
        .fetch_all(pool)
        .await?;

    let ids: Vec<i64> = rows.iter().map(|(id, _)| *id).collect();
    let mut media: HashMap<i64, _> = media_repository::find_many(pool, &ids)
        .await?
        .into_iter()
        .map(|media| (media.id, media))
        .collect();
    let mut entries: HashMap<i64, _> = entry_repository::find_many(pool, user_id, &ids)
        .await?
        .into_iter()
        .map(|entry| (entry.media_id, entry))
        .collect();

    Ok(rows
        .into_iter()
        .filter_map(|(id, manual_weekday)| {
            Some(ReleaseItem {
                media: media.remove(&id)?,
                entry: entries.remove(&id),
                manual_weekday,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        data::{models::entry::Entry, repositories::users as user_repository},
        infra::db::test_support::{media, user, TestDatabase},
    };

    async fn seed(pool: &PgPool) {
        user_repository::upsert(pool, &user(1)).await.unwrap();

        // Season anime nobody follows (shows in the season), with an airing time.
        let mut season = media(10, "ANIME", "Season Only");
        season.status = Some("RELEASING".into());
        season.season = Some("FALL".into());
        season.season_year = Some(2026);
        season.next_airing_at = Some(Utc::now());
        media_repository::upsert(pool, &season).await.unwrap();

        // Older anime the user watches, with no airing time: still listed, so a day can be chosen.
        let mut watching = media(11, "ANIME", "Watching Old");
        watching.status = Some("RELEASING".into());
        media_repository::upsert(pool, &watching).await.unwrap();
        entry_repository::upsert(pool, &Entry { status: "CURRENT".into(), ..Entry::blank(1, 11) })
            .await
            .unwrap();

        // Finished anime: never on the week.
        media_repository::upsert(pool, &media(12, "ANIME", "Finished")).await.unwrap();
        entry_repository::upsert(pool, &Entry { status: "CURRENT".into(), ..Entry::blank(1, 12) })
            .await
            .unwrap();

        let mut reading = media(20, "MANGA", "Reading");
        reading.status = Some("RELEASING".into());
        media_repository::upsert(pool, &reading).await.unwrap();
        entry_repository::upsert(pool, &Entry { status: "CURRENT".into(), ..Entry::blank(1, 20) })
            .await
            .unwrap();

        let mut planned = media(21, "MANGA", "Planned");
        planned.status = Some("RELEASING".into());
        media_repository::upsert(pool, &planned).await.unwrap();
        entry_repository::upsert(pool, &Entry::blank(1, 21)).await.unwrap();
    }

    #[tokio::test]
    async fn teste_semana_de_anime_junta_temporada_e_lista() {
        let Some(db) = TestDatabase::create().await else { return };
        seed(&db.pool).await;

        let items = week(&db.pool, 1, "ANIME", "FALL", 2026).await.unwrap();
        let ids: Vec<i64> = items.iter().map(|item| item.media.id).collect();
        assert_eq!(ids, [10, 11]);
        assert!(items[0].entry.is_none());
        assert_eq!(items[1].entry.as_ref().map(|entry| entry.status.as_str()), Some("CURRENT"));
        assert!(items.iter().all(|item| item.manual_weekday.is_none()));

        // Another season: only what the user follows.
        let ids: Vec<i64> = week(&db.pool, 1, "ANIME", "WINTER", 2027)
            .await
            .unwrap()
            .iter()
            .map(|item| item.media.id)
            .collect();
        assert_eq!(ids, [11]);
        db.drop().await;
    }

    #[tokio::test]
    async fn teste_semana_de_manga_e_dia_escolhido() {
        let Some(db) = TestDatabase::create().await else { return };
        seed(&db.pool).await;

        let items = week(&db.pool, 1, "MANGA", "FALL", 2026).await.unwrap();
        assert_eq!(items.iter().map(|item| item.media.id).collect::<Vec<_>>(), [20]);

        let saved = save_day(&db.pool, 1, 20, 3).await.unwrap();
        assert_eq!(saved.weekday, 3);
        save_day(&db.pool, 1, 20, 5).await.unwrap();
        let items = week(&db.pool, 1, "MANGA", "FALL", 2026).await.unwrap();
        assert_eq!(items[0].manual_weekday, Some(5));

        clear_day(&db.pool, 1, 20).await.unwrap();
        let items = week(&db.pool, 1, "MANGA", "FALL", 2026).await.unwrap();
        assert_eq!(items[0].manual_weekday, None);
        db.drop().await;
    }

    #[tokio::test]
    async fn teste_temporada_puxada_uma_vez() {
        let Some(db) = TestDatabase::create().await else { return };
        assert_eq!(season_pulled_at(&db.pool, "FALL", 2026).await.unwrap(), None);
        mark_season_pulled(&db.pool, "FALL", 2026).await.unwrap();
        let first = season_pulled_at(&db.pool, "FALL", 2026).await.unwrap().unwrap();
        mark_season_pulled(&db.pool, "FALL", 2026).await.unwrap();
        assert!(season_pulled_at(&db.pool, "FALL", 2026).await.unwrap().unwrap() >= first);
        db.drop().await;
    }
}
