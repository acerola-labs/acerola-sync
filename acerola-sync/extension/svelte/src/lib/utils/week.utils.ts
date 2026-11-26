import type { Media, ReleaseItem } from '$lib/api/types';
import { DISPLAY_TIME_ZONE } from './time.utils';

// The week screen: which day each title lands on, in Brasília time. The chosen day wins; then
// the AniList airing time; a title with neither has no day yet.

const DAYS_PER_WEEK = 7;
const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};

/** 0 = Sunday … 6 = Saturday, in Brasília, of a moment. */
export function weekdayInSaoPaulo(at: number | string | Date): number {
	const day = new Intl.DateTimeFormat('en-US', {
		timeZone: DISPLAY_TIME_ZONE,
		weekday: 'short'
	}).format(new Date(at));
	return WEEKDAY_INDEX[day] ?? 0;
}

export type WithDay = Pick<ReleaseItem, 'manualWeekday'> & {
	media: Pick<Media, 'nextAiringAt'>;
};

/** The day the title lands on, or `null` when nobody knows yet. */
export function releaseWeekday(item: WithDay): number | null {
	if (item.manualWeekday !== null && item.manualWeekday !== undefined) return item.manualWeekday;
	return item.media.nextAiringAt ? weekdayInSaoPaulo(item.media.nextAiringAt) : null;
}

/** The seven days starting at `start` (today first, so the week reads forward). */
export function orderedWeekdays(start: number): number[] {
	return Array.from({ length: DAYS_PER_WEEK }, (_, offset) => (start + offset) % DAYS_PER_WEEK);
}

/** How many days from `today` until `weekday` (0 = today, 1 = tomorrow…). */
export function daysUntil(weekday: number, today: number): number {
	return (weekday - today + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

/** Calendar date, in Brasília, of the next `weekday` from `now`. */
export function dateOfWeekday(weekday: number, now = Date.now()): Date {
	return new Date(now + daysUntil(weekday, weekdayInSaoPaulo(now)) * DAY_MS);
}

export type WeekGroup<T> = {
	/** `null` = no day yet. */
	weekday: number | null;
	items: T[];
};

/**
 * Splits the titles by day, today first and the dayless ones last. Within a day: by airing
 * time, then title. Days with nothing are left out.
 */
export function groupByWeekday<T extends WithDay & { media: Pick<Media, 'titleUserPreferred'> }>(
	items: T[],
	now = Date.now()
): WeekGroup<T>[] {
	const byDay = new Map<number | null, T[]>();
	for (const item of items) {
		const day = releaseWeekday(item);
		byDay.set(day, [...(byDay.get(day) ?? []), item]);
	}
	const order: (number | null)[] = [...orderedWeekdays(weekdayInSaoPaulo(now)), null];
	return order
		.filter((day) => byDay.has(day))
		.map((weekday) => ({ weekday, items: sortByTime(byDay.get(weekday) ?? []) }));
}

function sortByTime<T extends WithDay & { media: Pick<Media, 'titleUserPreferred'> }>(items: T[]) {
	return [...items].sort((a, b) => {
		const timeA = a.media.nextAiringAt ? clockMinutes(a.media.nextAiringAt) : Infinity;
		const timeB = b.media.nextAiringAt ? clockMinutes(b.media.nextAiringAt) : Infinity;
		if (timeA !== timeB) return timeA - timeB;
		return a.media.titleUserPreferred.localeCompare(b.media.titleUserPreferred, 'pt-BR');
	});
}

/** Minutes since midnight in Brasília: orders by the hour of the day, not the calendar date. */
function clockMinutes(iso: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: DISPLAY_TIME_ZONE,
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(new Date(iso));
	const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
	const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
	return hour * 60 + minute;
}
