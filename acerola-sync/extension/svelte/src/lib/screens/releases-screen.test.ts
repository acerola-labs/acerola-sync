import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseItem } from '$lib/api/types';
import { makeEntry, makeMedia } from '../../../tests/fixtures/media';
import { weekdayInSaoPaulo } from '$lib/utils/week.utils';

const api = { releasesWeek: vi.fn(), saveReleaseDay: vi.fn() };
const push = vi.fn();
vi.mock('$lib/state/app.svelte', () => ({
	app: {
		get api() {
			return api;
		},
		mode: 'popup',
		push: (...args: unknown[]) => push(...args),
		failScreen: vi.fn(),
		handleError: vi.fn()
	}
}));

import ReleasesScreen from './releases-screen.svelte';

const DAY = 86_400_000;
const inDays = (days: number, hour = 14) => {
	const at = new Date(Date.now() + days * DAY);
	at.setUTCHours(hour, 30, 0, 0);
	return at.toISOString();
};

function anime(id: number, title: string, airing: string, listed: boolean): ReleaseItem {
	return {
		media: makeMedia({
			id,
			titleUserPreferred: title,
			status: 'RELEASING',
			nextAiringEpisode: 7,
			nextAiringAt: airing
		}),
		entry: listed ? makeEntry({ mediaId: id, progress: 6 }) : null,
		manualWeekday: null
	};
}

describe('ReleasesScreen', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.releasesWeek.mockImplementation(async (type: string) =>
			type === 'ANIME'
				? [
						anime(1, 'Hoje à tarde', inDays(0, 18), true),
						anime(2, 'Depois de amanhã', inDays(2), true),
						anime(3, 'Só na temporada', inDays(2), false)
					]
				: [
						{
							media: makeMedia({
								id: 20,
								mediaType: 'MANGA',
								titleUserPreferred: 'Dandadan',
								nextAiringAt: null
							}),
							entry: makeEntry({ mediaId: 20, progress: 180 }),
							manualWeekday: null
						}
					]
		);
		api.saveReleaseDay.mockResolvedValue({ weekday: 2 });
	});

	it('agrupa a minha lista por dia, hoje primeiro, e esconde a temporada', async () => {
		render(ReleasesScreen);

		expect(await screen.findByText('Hoje à tarde')).toBeInTheDocument();
		expect(api.releasesWeek).toHaveBeenCalledWith('ANIME');
		expect(screen.queryByText('Só na temporada')).toBeNull();

		const lists = document.querySelectorAll<HTMLElement>('[data-weekday]');
		expect(lists[0].dataset.weekday).toBe(String(weekdayInSaoPaulo(Date.now())));
		expect(within(lists[0]).getByText('Hoje à tarde')).toBeInTheDocument();
		expect(screen.getByText(/Hoje · 1 obra|Today · 1 title/)).toBeInTheDocument();
		// Airing time in Brasília (18:30 UTC = 15:30).
		expect(screen.getByText('Ep 7 · 15:30')).toBeInTheDocument();
	});

	it('a temporada inteira mostra o que está fora da lista', async () => {
		const user = userEvent.setup();
		render(ReleasesScreen);
		await screen.findByText('Hoje à tarde');

		await user.click(screen.getByRole('tab', { name: /Temporada|Season/ }));
		expect(await screen.findByText('Só na temporada')).toBeInTheDocument();
		expect(screen.getByText(/Fora da lista|Not on your list/)).toBeInTheDocument();
	});

	it('mangá sem dia vai para "sem dia" e ganha o dia escolhido', async () => {
		const user = userEvent.setup();
		render(ReleasesScreen);
		await screen.findByText('Hoje à tarde');

		await user.click(screen.getByRole('tab', { name: /^Mang/ }));
		expect(await screen.findByText('Dandadan')).toBeInTheDocument();
		expect(api.releasesWeek).toHaveBeenLastCalledWith('MANGA');
		expect(screen.getByText(/Sem dia definido|No day yet/)).toBeInTheDocument();
		expect(screen.getByText(/Cap\. 180 lido|Ch\. 180 read/)).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: /Escolher o dia|Pick the day/ }));
		// The popover content is `visibility: hidden` in jsdom: found by text, not by name.
		await user.click(await screen.findByText(/Terça|Tuesday/));
		expect(api.saveReleaseDay).toHaveBeenCalledWith(20, 2);
		await vi.waitFor(() =>
			expect(document.querySelector('[data-weekday="2"]')).toBeInTheDocument()
		);
		expect(screen.queryByText(/Sem dia definido|No day yet/)).toBeNull();
	});

	it('abre a obra ao clicar no título', async () => {
		const user = userEvent.setup();
		render(ReleasesScreen);
		await user.click(await screen.findByRole('button', { name: 'Hoje à tarde' }));
		expect(push).toHaveBeenCalledWith({ name: 'media', mediaId: 1 });
	});
});
