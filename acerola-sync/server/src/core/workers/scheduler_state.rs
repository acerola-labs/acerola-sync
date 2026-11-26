//! What the scheduler needs to decide, per user, kept in memory.
//!
//! The 30 s tick reads only this map and goes to the database when a sync is really due or a
//! pending change has to be resent. The facts here change only inside this process, so the code
//! that changes them keeps the map current: the settings routes, the start of every sync (any
//! trigger) and the entries that stay pending. A restart reloads everything from the database.
//!
//! One instance only: with two replicas each one would keep its own map (the writes still go to
//! the database, so the worst case is a duplicated sync, which `sync_lock` and `Conflict` absorb).

use std::{
    collections::HashMap,
    sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard},
};

use chrono::{DateTime, NaiveTime, Utc};
use sqlx::PgPool;

use crate::{
    core::services::schedule,
    data::{
        models::sync::{SchedulerSnapshot, SyncSettings},
        repositories::sync as sync_repository,
    },
    infra::error::DbError,
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserSchedule {
    pub schedule_enabled: bool,
    /// Times in UTC.
    pub schedule_times: Vec<NaiveTime>,
    pub last_scheduled_slot: Option<DateTime<Utc>>,
    /// Automatic full list every N hours; `0` turns the automatic sync off.
    pub full_sync_every_hours: i32,
    /// Start of the last sync of any kind and any result.
    pub last_run_started_at: Option<DateTime<Utc>>,
    /// At least one entry with `dirty = true` waiting to reach AniList.
    pub has_pending: bool,
}

impl From<SchedulerSnapshot> for UserSchedule {
    fn from(row: SchedulerSnapshot) -> Self {
        Self {
            schedule_enabled: row.schedule_enabled,
            schedule_times: row.schedule_times,
            last_scheduled_slot: row.last_scheduled_slot,
            full_sync_every_hours: row.full_sync_every_hours,
            last_run_started_at: row.last_run_started_at,
            has_pending: row.has_pending,
        }
    }
}

#[derive(Clone, Default)]
pub struct SchedulerState {
    users: Arc<RwLock<HashMap<i64, UserSchedule>>>,
}

impl SchedulerState {
    /// Everything from the database, at startup.
    pub async fn load(&self, pool: &PgPool) -> Result<(), DbError> {
        let rows = sync_repository::scheduler_snapshot(pool, None).await?;
        let mut users = self.write();
        users.clear();
        for row in rows {
            users.insert(row.user_id, row.into());
        }
        Ok(())
    }

    /// One user from the database (login): the first login has no settings row yet, and the
    /// defaults apply until the first sync creates it.
    pub async fn refresh_user(&self, pool: &PgPool, user_id: i64) -> Result<(), DbError> {
        let rows = sync_repository::scheduler_snapshot(pool, Some(user_id)).await?;
        let mut users = self.write();
        for row in rows {
            users.insert(row.user_id, row.into());
        }
        Ok(())
    }

    /// The schedule or the automatic interval was saved on the screen.
    pub fn settings_saved(&self, settings: &SyncSettings) {
        let mut users = self.write();
        let user = users.entry(settings.user_id).or_default();
        user.schedule_enabled = settings.schedule_enabled;
        user.schedule_times = settings.schedule_times.clone();
        user.last_scheduled_slot = settings.last_scheduled_slot;
        user.full_sync_every_hours = settings.full_sync_every_hours;
    }

    pub fn slot_done(&self, user_id: i64, slot: DateTime<Utc>) {
        if let Some(user) = self.write().get_mut(&user_id) {
            user.last_scheduled_slot = Some(slot);
        }
    }

    /// A sync of any trigger started (counts even if it fails later).
    pub fn run_started(&self, user_id: i64, started_at: DateTime<Utc>) {
        self.write().entry(user_id).or_default().last_run_started_at = Some(started_at);
    }

    pub fn pending_changed(&self, user_id: i64, has_pending: bool) {
        self.write().entry(user_id).or_default().has_pending = has_pending;
    }

    /// Users whose scheduled time is due now, with the time to mark as served.
    pub fn due_scheduled(&self, now: DateTime<Utc>) -> Vec<(i64, DateTime<Utc>)> {
        self.read()
            .iter()
            .filter(|(_, user)| user.schedule_enabled)
            .filter_map(|(user_id, user)| {
                schedule::due_slot(&user.schedule_times, user.last_scheduled_slot, now)
                    .map(|slot| (*user_id, slot))
            })
            .collect()
    }

    /// Users whose automatic sync is due now.
    pub fn due_auto(&self, now: DateTime<Utc>) -> Vec<i64> {
        self.read()
            .iter()
            .filter(|(_, user)| {
                schedule::auto_due(user.full_sync_every_hours, user.last_run_started_at, now)
            })
            .map(|(user_id, _)| *user_id)
            .collect()
    }

    pub fn with_pending(&self) -> Vec<i64> {
        self.read()
            .iter()
            .filter(|(_, user)| user.has_pending)
            .map(|(user_id, _)| *user_id)
            .collect()
    }

    pub fn get(&self, user_id: i64) -> Option<UserSchedule> {
        self.read().get(&user_id).cloned()
    }

    fn read(&self) -> RwLockReadGuard<'_, HashMap<i64, UserSchedule>> {
        self.users.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, HashMap<i64, UserSchedule>> {
        self.users.write().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 7, hour, minute, 0).unwrap()
    }

    fn time(hour: u32, minute: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(hour, minute, 0).unwrap()
    }

    fn settings(user_id: i64, enabled: bool, times: &[NaiveTime], hours: i32) -> SyncSettings {
        SyncSettings {
            user_id,
            schedule_enabled: enabled,
            schedule_times: times.to_vec(),
            last_scheduled_slot: None,
            updated_at: at(0, 0),
            last_pull_at: None,
            last_full_sync_at: None,
            full_sync_every_hours: hours,
        }
    }

    #[test]
    fn test_scheduled_time_is_due_once_and_only_when_enabled() {
        let state = SchedulerState::default();
        state.settings_saved(&settings(1, true, &[time(9, 0)], 0));
        state.settings_saved(&settings(2, false, &[time(9, 0)], 0));

        assert_eq!(state.due_scheduled(at(9, 1)), vec![(1, at(9, 0))]);
        state.slot_done(1, at(9, 0));
        assert!(state.due_scheduled(at(9, 30)).is_empty());
    }

    #[test]
    fn test_auto_sync_counts_from_the_last_run_of_any_kind() {
        let state = SchedulerState::default();
        state.settings_saved(&settings(1, false, &[], 24));
        state.settings_saved(&settings(2, false, &[], 0));

        assert_eq!(state.due_auto(at(9, 0)), vec![1]);
        state.run_started(1, at(9, 0));
        assert!(state.due_auto(at(9, 59)).is_empty());
        assert_eq!(state.due_auto(at(10, 0)), vec![1]);
    }

    #[test]
    fn test_saving_settings_keeps_what_the_screen_does_not_change() {
        let state = SchedulerState::default();
        state.run_started(1, at(8, 0));
        state.pending_changed(1, true);
        state.settings_saved(&settings(1, true, &[time(12, 0)], 6));

        let user = state.get(1).unwrap();
        assert_eq!(user.last_run_started_at, Some(at(8, 0)));
        assert!(user.has_pending);
        assert_eq!(user.full_sync_every_hours, 6);
        assert_eq!(user.schedule_times, vec![time(12, 0)]);
    }

    #[test]
    fn test_pending_flag_lists_and_clears_the_user() {
        let state = SchedulerState::default();
        assert!(state.with_pending().is_empty());
        state.pending_changed(7, true);
        assert_eq!(state.with_pending(), vec![7]);
        state.pending_changed(7, false);
        assert!(state.with_pending().is_empty());
    }
}
