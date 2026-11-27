import type { EntryWithMedia, Media } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';
import { formatDateTime } from '$lib/utils/time.utils';

// Notices the extension sends through the system. The server keeps the mirror fresh (automatic
// hourly sync); the background compares it with what was seen on the last look:
// - `episode`: a new episode of an anime in progress aired (also the number on the icon);
// - `dated`, `delayed`, `released`, `cancelled`: a planned title got a premiere date, had it
//   pushed back, came out, or was cancelled on AniList.

/** Last aired episode of an airing anime; `null` when there is no way to know. */
export function latestAired(media: Pick<Media, 'nextAiringEpisode' | 'nextAiringAt'>, now: number) {
	if (!media.nextAiringEpisode) return null;
	const airsAt = media.nextAiringAt ? Date.parse(media.nextAiringAt) : NaN;
	// The next one is already past its time (the mirror only updates on the next sync): it aired too.
	const aired = airsAt <= now ? media.nextAiringEpisode : media.nextAiringEpisode - 1;
	return aired > 0 ? aired : null;
}

export type NoticeKind = 'episode' | 'dated' | 'delayed' | 'released' | 'cancelled';

export type Notice = {
	/** Missing on notices stored before the planned alerts existed: an `episode` one. */
	kind?: NoticeKind;
	mediaId: number;
	title: string;
	cover: string | null;
	/** Aired episode (`episode` notices). */
	episode?: number;
	/** Premiere date the notice is about (`dated`/`delayed`), ISO UTC; `null` when unknown (hiatus). */
	when?: string | null;
};

/** @deprecated name kept for the airing check; an `episode` notice. */
export type NewEpisode = Notice;

export type AiringCheck = {
	/** Media with an aired episode beyond the progress (the number on the icon). */
	behind: number;
	/** Episodes aired since the last check (they become notifications). */
	fresh: Notice[];
	/** Last episode seen per media, for the next check. */
	seen: Record<string, number>;
};

/**
 * Compares what aired with what was already seen. A media seen for the first time only enters
 * the baseline, with no notice: otherwise the first check would notify the whole backlog at once.
 */
export function checkAiring(
	entries: EntryWithMedia[],
	seen: Record<string, number>,
	now: number
): AiringCheck {
	const next: Record<string, number> = {};
	const fresh: Notice[] = [];
	let behind = 0;

	for (const entry of entries) {
		if (entry.media.mediaType !== 'ANIME') continue;
		const aired = latestAired(entry.media, now);
		if (!aired) continue;
		if (aired > entry.progress) behind++;

		const key = String(entry.mediaId);
		const before = seen[key];
		next[key] = Math.max(aired, before ?? 0);
		if (before !== undefined && aired > before && aired > entry.progress) {
			fresh.push({
				kind: 'episode',
				mediaId: entry.mediaId,
				title: entry.media.titleUserPreferred,
				episode: aired,
				cover: entry.media.coverUrl
			});
		}
	}
	return { behind, fresh, seen: next };
}

/** What was known about a planned title on the last look. */
export type PlannedState = {
	status: string | null;
	/** Episode 1 airing time, while not yet released. */
	premiere: string | null;
	/** Already notified as released: the status flip that follows must not notify again. */
	released: boolean;
};

export type PlannedCheck = {
	fresh: Notice[];
	seen: Record<string, PlannedState>;
};

/** Pushed back by less than this is AniList adjusting the hour, not a delay. */
const DELAY_THRESHOLD_MS = 3_600_000;

function plannedState(media: Media, now: number): PlannedState {
	const notYet = media.status === 'NOT_YET_RELEASED';
	const premiere = notYet && media.nextAiringEpisode === 1 ? media.nextAiringAt : null;
	return {
		status: media.status,
		premiere,
		// A premiere whose time has passed counts as out even before AniList flips the status.
		released:
			media.status === 'RELEASING' ||
			media.status === 'FINISHED' ||
			(!!premiere && Date.parse(premiere) <= now)
	};
}

/**
 * Planned titles (anime and manga): notices for a premiere date that appeared, moved later or
 * arrived, and for a cancellation. First sighting is baseline only, like `checkAiring`.
 */
export function checkPlanned(
	entries: EntryWithMedia[],
	seen: Record<string, PlannedState>,
	now: number
): PlannedCheck {
	const next: Record<string, PlannedState> = {};
	const fresh: Notice[] = [];

	for (const entry of entries) {
		const key = String(entry.mediaId);
		const before = seen[key];
		const current = plannedState(entry.media, now);
		const base = {
			mediaId: entry.mediaId,
			title: entry.media.titleUserPreferred,
			cover: entry.media.coverUrl
		};

		if (before && !before.released) {
			if (current.status === 'CANCELLED') {
				fresh.push({ kind: 'cancelled', ...base });
			} else if (current.released) {
				fresh.push({ kind: 'released', ...base });
			} else if (current.status === 'HIATUS' && before.status !== 'HIATUS') {
				fresh.push({ kind: 'delayed', when: null, ...base });
			} else if (!before.premiere && current.premiere) {
				fresh.push({ kind: 'dated', when: current.premiere, ...base });
			} else if (
				before.premiere &&
				current.premiere &&
				Date.parse(current.premiere) > Date.parse(before.premiere) + DELAY_THRESHOLD_MS
			) {
				fresh.push({ kind: 'delayed', when: current.premiere, ...base });
			}
		}
		// Once notified as released or cancelled, stays quiet.
		next[key] = {
			...current,
			released: current.released || current.status === 'CANCELLED' || !!before?.released
		};
	}
	return { fresh, seen: next };
}

/** Notice already sent through the system, kept for the notifications screen. */
export type NotificationItem = Notice & {
	/** Same id as the system notification (`airing:{mediaId}:{episode}`, `dated:{mediaId}:{when}`…). */
	id: string;
	/** When it notified, in ISO (UTC). */
	at: string;
	read: boolean;
};

/** How many notices the screen keeps; the oldest drop out. */
export const NOTIFICATIONS_KEPT = 50;

export function notificationId(notice: Notice) {
	switch (notice.kind ?? 'episode') {
		case 'episode':
			return `airing:${notice.mediaId}:${notice.episode}`;
		case 'dated':
		case 'delayed':
			return `${notice.kind}:${notice.mediaId}:${notice.when ?? 'unknown'}`;
		default:
			return `${notice.kind}:${notice.mediaId}`;
	}
}

/** Media id of a system notification id; `null` when the id is not one of ours. */
export function mediaIdFromNotification(id: string): number | null {
	const [prefix, mediaId] = id.split(':');
	if (!['airing', 'dated', 'delayed', 'released', 'cancelled'].includes(prefix)) return null;
	const parsed = Number(mediaId);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The one line of the notice, in the screen language. */
export function noticeMessage(notice: Notice): string {
	switch (notice.kind ?? 'episode') {
		case 'dated':
			return m['sync.airing.dated']({ date: formatDateTime(notice.when) });
		case 'delayed':
			return notice.when
				? m['sync.airing.delayed']({ date: formatDateTime(notice.when) })
				: m['sync.airing.hiatus']();
		case 'released':
			return m['sync.airing.released']();
		case 'cancelled':
			return m['sync.airing.cancelled']();
		default:
			return m['sync.airing.episode']({ episode: notice.episode ?? 0 });
	}
}

/** Puts new notices on top, without repeating the same one, and keeps only the last 50. */
export function addNotifications(
	list: NotificationItem[],
	fresh: Notice[],
	now: number
): NotificationItem[] {
	const at = new Date(now).toISOString();
	const added = fresh.map((notice) => ({
		...notice,
		id: notificationId(notice),
		at,
		read: false
	}));
	const ids = new Set(added.map((item) => item.id));
	return [...added, ...list.filter((item) => !ids.has(item.id))].slice(0, NOTIFICATIONS_KEPT);
}
