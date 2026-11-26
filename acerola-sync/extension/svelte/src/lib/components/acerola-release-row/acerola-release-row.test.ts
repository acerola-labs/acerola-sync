import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeEntry, makeMedia } from '../../../../tests/fixtures/media';
import AcerolaReleaseRow from './acerola-release-row.svelte';

describe('AcerolaReleaseRow', () => {
	it('mostra título, horário, estado na lista e abre a obra', async () => {
		const onOpen = vi.fn();
		render(AcerolaReleaseRow, {
			props: {
				data: {
					item: { media: makeMedia(), entry: makeEntry(), manualWeekday: null },
					caption: 'Ep 7 · 14:30',
					detail: 'Ep 3 de 12'
				},
				events: { onOpen }
			}
		});

		expect(screen.getByText('Sousou no Frieren')).toBeInTheDocument();
		expect(screen.getByText('Ep 7 · 14:30')).toBeInTheDocument();
		expect(screen.getByText(/Assistindo|Watching/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Escolher o dia|Pick the day/ })).toBeNull();

		await userEvent.setup().click(screen.getByRole('button', { name: 'Sousou no Frieren' }));
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it('fora da lista mostra o aviso e os episódios atrasados vencem o estado', () => {
		render(AcerolaReleaseRow, {
			props: {
				data: {
					item: { media: makeMedia(), entry: null, manualWeekday: null },
					caption: ''
				}
			}
		});
		expect(screen.getByText(/Fora da lista|Not on your list/)).toBeInTheDocument();

		render(AcerolaReleaseRow, {
			props: {
				data: {
					item: {
						media: makeMedia({ id: 2, status: 'RELEASING', nextAiringEpisode: 7 }),
						entry: makeEntry({ mediaId: 2, progress: 4 }),
						manualWeekday: null
					},
					caption: ''
				}
			}
		});
		expect(screen.getByText(/\+2/)).toBeInTheDocument();
	});

	it('escolhe um dia no seletor e volta a seguir o AniList', async () => {
		const user = userEvent.setup();
		const onPickDay = vi.fn();
		render(AcerolaReleaseRow, {
			props: {
				data: {
					item: {
						media: makeMedia({ mediaType: 'MANGA', nextAiringAt: null }),
						entry: makeEntry(),
						manualWeekday: 3
					},
					caption: 'Cap. 40 lido'
				},
				events: { onPickDay }
			}
		});

		// The chosen day shows on the trigger.
		const trigger = screen.getByRole('button', { name: /Escolher o dia|Pick the day/ });
		expect(trigger).toHaveTextContent(/Quarta|Wednesday/);

		// The floating content has `visibility: hidden` in jsdom (nothing measures it), which
		// empties the accessible names: the options are found by their text.
		await user.click(trigger);
		await user.click(await screen.findByText(/Sexta|Friday/));
		expect(onPickDay).toHaveBeenCalledWith(5);

		await user.click(screen.getByRole('button', { name: /Escolher o dia|Pick the day/ }));
		await user.click(await screen.findByText(/^(Sem dia|No day)$/));
		expect(onPickDay).toHaveBeenLastCalledWith(null);
	});
});
