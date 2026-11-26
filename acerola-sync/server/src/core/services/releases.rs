use chrono::{DateTime, Datelike, Duration, Utc};

use super::{clock::brasilia_offset, entries as entry_service};
use crate::{
    bios::state::AppState,
    data::{
        models::{
            media::Media,
            release::{ReleaseDay, ReleaseItem},
            user::User,
        },
        repositories::{media as media_repository, releases as release_repository},
    },
    infra::error::AppError,
};

/// How many pages (of 50) of the season are mirrored: the 150 most popular cover what airs.
const SEASON_PAGES: u32 = 3;
/// The season list is pulled again after this long (what is airing changes little in a day).
const SEASON_REFRESH: Duration = Duration::hours(24);

/// AniList season of a moment, by the Brasília calendar: Jan–Mar winter, Apr–Jun spring,
/// Jul–Sep summer, Oct–Dec fall.
pub fn current_season(now: DateTime<Utc>) -> (&'static str, i32) {
    let local = now.with_timezone(&brasilia_offset());
    let season = match local.month() {
        1..=3 => "WINTER",
        4..=6 => "SPRING",
        7..=9 => "SUMMER",
        _ => "FALL",
    };
    (season, local.year())
}

/// Mirrors the current season's anime. The first time, waits for it (the screen would be
/// empty otherwise); after that, a stale list is refreshed in the background and the screen
/// gets what the mirror has now.
async fn ensure_season(state: &AppState, user: &User) -> Result<(), AppError> {
    let now = Utc::now();
    let (season, year) = current_season(now);
    match release_repository::season_pulled_at(&state.database_pool, season, year).await? {
        Some(at) if now - at < SEASON_REFRESH => Ok(()),
        Some(_) => {
            let state = state.clone();
            let user = user.clone();
            tokio::spawn(async move {
                if let Err(error) = pull_season(&state, &user, season, year).await {
                    tracing::warn!("[Releases] Season refresh failed: {}", error);
                }
            });
            Ok(())
        },
        None => pull_season(state, user, season, year).await,
    }
}

async fn pull_season(
    state: &AppState, user: &User, season: &str, year: i32,
) -> Result<(), AppError> {
    let token = state.anilist_token(user)?;
    let mut stored = 0;
    for page in 1..=SEASON_PAGES {
        let (media, has_next) = state.anilist.season(Some(&token), season, year, page).await?;
        let mut transaction = state.database_pool.begin().await?;
        for media in media {
            media_repository::upsert(&mut *transaction, &Media::from(media)).await?;
            stored += 1;
        }
        transaction.commit().await?;
        if !has_next {
            break;
        }
    }
    release_repository::mark_season_pulled(&state.database_pool, season, year).await?;
    tracing::info!("[Releases] Season {} {} mirrored: {} titles", season, year, stored);
    Ok(())
}

/// The week of one type (`ANIME` or `MANGA`), from the mirror.
pub async fn week(
    state: &AppState, user: &User, media_type: &str,
) -> Result<Vec<ReleaseItem>, AppError> {
    if media_type == "ANIME" {
        ensure_season(state, user).await?;
    }
    let (season, year) = current_season(Utc::now());
    Ok(release_repository::week(&state.database_pool, user.id, media_type, season, year).await?)
}

/// Chooses (0–6) or clears (`None`) the day of a media. The media enters the mirror if it is
/// not there yet (1 AniList request, once).
pub async fn save_day(
    state: &AppState, user: &User, media_id: i64, weekday: Option<i16>,
) -> Result<Option<ReleaseDay>, AppError> {
    entry_service::ensure_media(state, user, media_id).await?;
    match weekday {
        Some(weekday) if (0..=6).contains(&weekday) => Ok(Some(
            release_repository::save_day(&state.database_pool, user.id, media_id, weekday).await?,
        )),
        Some(_) => Err(AppError::BadRequest("weekday must be between 0 and 6.".into())),
        None => {
            release_repository::clear_day(&state.database_pool, user.id, media_id).await?;
            Ok(None)
        },
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn at(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, hour, 0, 0).unwrap()
    }

    #[test]
    fn test_current_season_follows_the_brasilia_calendar() {
        assert_eq!(current_season(at(2026, 2, 10, 12)), ("WINTER", 2026));
        assert_eq!(current_season(at(2026, 5, 1, 12)), ("SPRING", 2026));
        assert_eq!(current_season(at(2026, 8, 20, 12)), ("SUMMER", 2026));
        assert_eq!(current_season(at(2026, 11, 26, 12)), ("FALL", 2026));
        // 01:00 UTC on Jan 1st is still Dec 31st in Brasília.
        assert_eq!(current_season(at(2027, 1, 1, 1)), ("FALL", 2026));
        assert_eq!(current_season(at(2027, 1, 1, 4)), ("WINTER", 2027));
    }
}
