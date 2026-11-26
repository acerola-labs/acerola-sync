use std::time::Duration;

use chrono::Utc;

use crate::{
    bios::state::AppState,
    core::services::{entries as entry_service, sync as sync_service},
    data::repositories::{sync as sync_repository, users as user_repository},
    infra::error::AppError,
};

const TICK: Duration = Duration::from_secs(30);
/// Every how many ticks it tries to resend what was left pending (10 × 30 s = 5 min).
const PUSH_EVERY_TICKS: u32 = 10;

/// Background loop: runs the sync at the chosen times (UTC), the hourly automatic one and
/// resends pending changes. Every tick decides from `state.scheduler` (memory) and only touches
/// the database when something is really due, so an idle server keeps the database idle too.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        if let Err(error) = sync_repository::fail_stale_runs(&state.database_pool).await {
            tracing::warn!("[Scheduler] Could not close stale runs: {}", error);
        }

        let mut interval = tokio::time::interval(TICK);
        let mut tick: u32 = 0;
        loop {
            interval.tick().await;
            tick = tick.wrapping_add(1);

            if let Err(error) = run_due_syncs(&state).await {
                tracing::warn!("[Scheduler] Scheduled sync check failed: {}", error);
            }
            if let Err(error) = run_auto_syncs(&state).await {
                tracing::warn!("[Scheduler] Automatic sync check failed: {}", error);
            }
            if tick.is_multiple_of(PUSH_EVERY_TICKS) {
                if let Err(error) = push_all_pending(&state).await {
                    tracing::warn!("[Scheduler] Pending push failed: {}", error);
                }
            }
        }
    });
}

pub async fn run_due_syncs(state: &AppState) -> Result<(), AppError> {
    for (user_id, slot) in state.scheduler.due_scheduled(Utc::now()) {
        let Some(user) = user_repository::find(&state.database_pool, user_id).await? else {
            continue;
        };

        // Marks before running (database and memory): if the sync fails, it does not keep
        // retrying every 30 s.
        sync_repository::mark_slot_done(&state.database_pool, user.id, slot).await?;
        state.scheduler.slot_done(user.id, slot);
        tracing::info!("[Scheduler] Running scheduled sync for slot {}", slot);
        if let Err(error) = sync_service::run(state, &user, "SCHEDULED", false).await {
            tracing::warn!("[Scheduler] Scheduled sync failed: {}", error);
        }
    }
    Ok(())
}

/// Automatic sync: what changed, hourly, and the whole list once the chosen interval is past
/// (`choose_mode` decides). Keeps the next episode up to date for the extension's notices.
pub async fn run_auto_syncs(state: &AppState) -> Result<(), AppError> {
    for user_id in state.scheduler.due_auto(Utc::now()) {
        let Some(user) = user_repository::find(&state.database_pool, user_id).await? else {
            continue;
        };
        match sync_service::run(state, &user, "AUTO", false).await {
            Ok(_) | Err(AppError::Conflict(_)) => {},
            Err(error) => tracing::warn!("[Scheduler] Automatic sync failed: {}", error),
        }
    }
    Ok(())
}

pub async fn push_all_pending(state: &AppState) -> Result<(), AppError> {
    for user_id in state.scheduler.with_pending() {
        let Some(user) = user_repository::find(&state.database_pool, user_id).await? else {
            state.scheduler.pending_changed(user_id, false);
            continue;
        };
        let pushed = entry_service::push_pending(state, &user).await?;
        if pushed > 0 {
            tracing::info!("[Scheduler] Pushed {} pending entries", pushed);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, NaiveTime};
    use sqlx::postgres::PgPoolOptions;

    use super::*;
    use crate::{data::models::sync::SyncSettings, infra::anilist::AnilistClient};

    /// A pool that fails on the first query: proves which ticks never reach the database.
    fn state_without_database() -> AppState {
        let pool = PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(200))
            .connect_lazy("postgres://nobody:nothing@127.0.0.1:9/none")
            .expect("URL válida");
        AppState::new(pool, AnilistClient::new("http://127.0.0.1:9"), [0; 32], "1".into(), None)
    }

    #[tokio::test]
    async fn test_idle_tick_does_not_touch_the_database() {
        let state = state_without_database();
        state.scheduler.settings_saved(&SyncSettings {
            user_id: 1,
            schedule_enabled: true,
            schedule_times: vec![NaiveTime::from_hms_opt(3, 0, 0).unwrap()],
            last_scheduled_slot: Some(Utc::now()),
            updated_at: Utc::now(),
            last_pull_at: None,
            last_full_sync_at: None,
            full_sync_every_hours: 24,
        });
        state.scheduler.run_started(1, Utc::now());

        assert!(run_due_syncs(&state).await.is_ok());
        assert!(run_auto_syncs(&state).await.is_ok());
        assert!(push_all_pending(&state).await.is_ok());
    }

    #[tokio::test]
    async fn test_due_work_goes_to_the_database() {
        let state = state_without_database();
        state.scheduler.run_started(1, Utc::now() - Duration::hours(2));
        state.scheduler.settings_saved(&SyncSettings {
            user_id: 1,
            schedule_enabled: false,
            schedule_times: vec![],
            last_scheduled_slot: None,
            updated_at: Utc::now(),
            last_pull_at: None,
            last_full_sync_at: None,
            full_sync_every_hours: 24,
        });
        state.scheduler.pending_changed(2, true);

        assert!(run_auto_syncs(&state).await.is_err());
        assert!(push_all_pending(&state).await.is_err());
    }
}
