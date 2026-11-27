import { describe, expect, it } from 'vitest';
import type { EntryWithMedia } from '$lib/api/types';
import {
	addNotifications,
	checkAiring,
	checkPlanned,
	latestAired,
	mediaIdFromNotification,
	notificationId,
	NOTIFICATIONS_KEPT,
	type PlannedState
} from './airing.service';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const HOUR = 3_600_000;

function entry(
	mediaId: number,
	progress: number,
	nextAiringEpisode: number | null,
	nextAiringAt: string | null,
	mediaType: 'ANIME' | 'MANGA' = 'ANIME'
) {
	return {
		mediaId,
		progress,
		media: {
			mediaType,
			titleUserPreferred: `Obra ${mediaId}`,
			coverUrl: null,
			nextAiringEpisode,
			nextAiringAt
		}
	} as unknown as EntryWithMedia;
}

describe('latestAired', () => {
	it('é o anterior ao próximo, ou o próprio próximo se a hora dele já passou', () => {
		const future = new Date(NOW + HOUR).toISOString();
		const past = new Date(NOW - HOUR).toISOString();
		expect(latestAired({ nextAiringEpisode: 8, nextAiringAt: future }, NOW)).toBe(7);
		expect(latestAired({ nextAiringEpisode: 8, nextAiringAt: past }, NOW)).toBe(8);
		expect(latestAired({ nextAiringEpisode: 1, nextAiringAt: future }, NOW)).toBeNull();
		expect(latestAired({ nextAiringEpisode: null, nextAiringAt: null }, NOW)).toBeNull();
	});
});

describe('checkAiring', () => {
	const future = new Date(NOW + HOUR).toISOString();

	it('primeira conferência só monta a base, sem avisar da lista atrasada', () => {
		const result = checkAiring([entry(1, 3, 8, future), entry(2, 7, 8, future)], {}, NOW);
		expect(result.fresh).toEqual([]);
		expect(result.behind).toBe(1);
		expect(result.seen).toEqual({ 1: 7, 2: 7 });
	});

	it('avisa o episódio que saiu desde a última conferência', () => {
		const result = checkAiring([entry(1, 7, 9, future)], { 1: 7 }, NOW);
		expect(result.fresh).toEqual([
			{ kind: 'episode', mediaId: 1, title: 'Obra 1', episode: 8, cover: null }
		]);
		expect(result.behind).toBe(1);
		expect(result.seen).toEqual({ 1: 8 });
	});

	it('não avisa o que você já assistiu nem repete o mesmo episódio', () => {
		expect(checkAiring([entry(1, 8, 9, future)], { 1: 7 }, NOW).fresh).toEqual([]);
		expect(checkAiring([entry(1, 7, 9, future)], { 1: 8 }, NOW).fresh).toEqual([]);
	});

	it('ignora mangá e anime sem próximo episódio', () => {
		const result = checkAiring(
			[entry(1, 0, 5, future, 'MANGA'), entry(2, 3, null, null)],
			{ 1: 1, 2: 1 },
			NOW
		);
		expect(result).toEqual({ behind: 0, fresh: [], seen: {} });
	});
});

describe('checkPlanned', () => {
	const future = new Date(NOW + 10 * 24 * HOUR).toISOString();
	const later = new Date(NOW + 17 * 24 * HOUR).toISOString();
	const past = new Date(NOW - HOUR).toISOString();

	function planned(
		mediaId: number,
		status: string | null,
		premiere: string | null,
		mediaType: 'ANIME' | 'MANGA' = 'ANIME'
	) {
		const item = entry(mediaId, 0, premiere ? 1 : null, premiere, mediaType);
		item.media.status = status;
		return item;
	}
	const known = (status: string, premiere: string | null, released = false): PlannedState => ({
		status,
		premiere,
		released
	});

	it('primeira olhada só guarda o estado', () => {
		const result = checkPlanned([planned(1, 'NOT_YET_RELEASED', null)], {}, NOW);
		expect(result.fresh).toEqual([]);
		expect(result.seen).toEqual({
			1: { status: 'NOT_YET_RELEASED', premiere: null, released: false }
		});
	});

	it('avisa quando ganha data e quando a data é adiada', () => {
		const dated = checkPlanned(
			[planned(1, 'NOT_YET_RELEASED', future)],
			{ 1: known('NOT_YET_RELEASED', null) },
			NOW
		);
		expect(dated.fresh).toMatchObject([{ kind: 'dated', mediaId: 1, when: future }]);

		const delayed = checkPlanned(
			[planned(1, 'NOT_YET_RELEASED', later)],
			{ 1: known('NOT_YET_RELEASED', future) },
			NOW
		);
		expect(delayed.fresh).toMatchObject([{ kind: 'delayed', mediaId: 1, when: later }]);

		// Moved by minutes: AniList adjusting the hour, not a delay.
		const nudged = new Date(Date.parse(future) + HOUR / 2).toISOString();
		expect(
			checkPlanned(
				[planned(1, 'NOT_YET_RELEASED', nudged)],
				{ 1: known('NOT_YET_RELEASED', future) },
				NOW
			).fresh
		).toEqual([]);
	});

	it('avisa o lançamento uma vez só, pelo status ou pela hora da estreia', () => {
		const byStatus = checkPlanned(
			[planned(2, 'RELEASING', null, 'MANGA')],
			{ 2: known('NOT_YET_RELEASED', null) },
			NOW
		);
		expect(byStatus.fresh).toMatchObject([{ kind: 'released', mediaId: 2 }]);
		expect(byStatus.seen[2].released).toBe(true);

		const byTime = checkPlanned(
			[planned(1, 'NOT_YET_RELEASED', past)],
			{ 1: known('NOT_YET_RELEASED', past) },
			NOW
		);
		expect(byTime.fresh).toMatchObject([{ kind: 'released', mediaId: 1 }]);
		// Next look, AniList flipped the status: already notified, nothing new.
		expect(checkPlanned([planned(1, 'RELEASING', null)], byTime.seen, NOW).fresh).toEqual([]);
	});

	it('avisa cancelamento e hiato, e nunca mexe no que já estava lançado', () => {
		expect(
			checkPlanned(
				[planned(1, 'CANCELLED', null)],
				{ 1: known('NOT_YET_RELEASED', null) },
				NOW
			).fresh
		).toMatchObject([{ kind: 'cancelled' }]);
		expect(
			checkPlanned([planned(1, 'HIATUS', null)], { 1: known('NOT_YET_RELEASED', null) }, NOW)
				.fresh
		).toMatchObject([{ kind: 'delayed', when: null }]);
		expect(
			checkPlanned([planned(1, 'FINISHED', null)], { 1: known('RELEASING', null, true) }, NOW)
				.fresh
		).toEqual([]);
	});

	it('ids das notificações levam o tipo e a obra', () => {
		expect(
			notificationId({ kind: 'episode', mediaId: 1, title: '', cover: null, episode: 8 })
		).toBe('airing:1:8');
		expect(
			notificationId({ kind: 'dated', mediaId: 1, title: '', cover: null, when: future })
		).toBe(`dated:1:${future}`);
		expect(notificationId({ kind: 'released', mediaId: 3, title: '', cover: null })).toBe(
			'released:3'
		);
		expect(mediaIdFromNotification('airing:1:8')).toBe(1);
		expect(mediaIdFromNotification('released:3')).toBe(3);
		expect(mediaIdFromNotification('other:3')).toBeNull();
	});
});

describe('addNotifications', () => {
	const episode = (mediaId: number, ep: number) => ({
		kind: 'episode' as const,
		mediaId,
		title: `Obra ${mediaId}`,
		episode: ep,
		cover: null
	});

	it('põe o novo no topo, sem ler, com o id da notificação do sistema', () => {
		const first = addNotifications([], [episode(1, 4)], NOW);
		const next = addNotifications(first, [episode(2, 7)], NOW + HOUR);
		expect(next.map((item) => item.id)).toEqual(['airing:2:7', 'airing:1:4']);
		expect(next[0]).toMatchObject({ read: false, at: new Date(NOW + HOUR).toISOString() });
	});

	it('não repete o mesmo episódio e guarda só os últimos', () => {
		const again = addNotifications(
			addNotifications([], [episode(1, 4)], NOW),
			[episode(1, 4)],
			NOW
		);
		expect(again).toHaveLength(1);

		const many = Array.from({ length: NOTIFICATIONS_KEPT + 5 }, (_, i) => episode(i + 1, 1));
		const kept = addNotifications([], many, NOW);
		expect(kept).toHaveLength(NOTIFICATIONS_KEPT);
		expect(kept[0].mediaId).toBe(1);
	});
});
