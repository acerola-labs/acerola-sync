use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

use super::{entry::Entry, media::Media};

/// Day of the week the user chose for a media (0 = Sunday … 6 = Saturday, Brasília time).
#[derive(Debug, Clone, FromRow, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDay {
    pub user_id: i64,
    pub media_id: i64,
    pub weekday: i16,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One title on the week screen. The screen decides the day: the chosen one wins, then the
/// AniList airing time (`media.next_airing_at`), else "no day yet".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseItem {
    pub media: Media,
    pub entry: Option<Entry>,
    pub manual_weekday: Option<i16>,
}
