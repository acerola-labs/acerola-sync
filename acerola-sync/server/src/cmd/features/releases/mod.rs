use axum::{
    extract::{Path, Query, State},
    Json,
};

use super::auth::AuthUser;
use crate::{
    bios::state::AppState,
    cmd::events::releases::{ReleaseDayRequest, WeekQuery},
    core::services::releases as release_service,
    data::models::release::{ReleaseDay, ReleaseItem},
    infra::error::AppError,
};

/// `GET /releases/week?mediaType=`: what airs or comes out, for the week screen.
pub async fn week(
    State(state): State<AppState>, auth: AuthUser, Query(query): Query<WeekQuery>,
) -> Result<Json<Vec<ReleaseItem>>, AppError> {
    let media_type = query.media_type.as_deref().map(str::to_uppercase);
    let media_type = media_type.as_deref().unwrap_or("ANIME");
    if !["ANIME", "MANGA"].contains(&media_type) {
        return Err(AppError::BadRequest("mediaType must be ANIME or MANGA.".into()));
    }
    Ok(Json(release_service::week(&state, &auth.user, media_type).await?))
}

/// `PUT /releases/{media_id}/day`: the day the user chose; `{ "weekday": null }` clears it.
pub async fn save_day(
    State(state): State<AppState>, auth: AuthUser, Path(media_id): Path<i64>,
    Json(request): Json<ReleaseDayRequest>,
) -> Result<Json<Option<ReleaseDay>>, AppError> {
    Ok(Json(release_service::save_day(&state, &auth.user, media_id, request.weekday).await?))
}
