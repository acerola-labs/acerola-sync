use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekQuery {
    /// `ANIME` (default) or `MANGA`.
    pub media_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDayRequest {
    /// 0 = Sunday … 6 = Saturday (Brasília); `null` goes back to the AniList time.
    pub weekday: Option<i16>,
}
