import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeEntry, makeMedia } from '../../../../tests/fixtures/media';
import AcerolaReleaseCard from './acerola-release-card.svelte';

describe('AcerolaReleaseCard', () => {
	it('mostra a capa com o horário, a legenda, e abre a obra', async () => {
		const onOpen = vi.fn();
		render(AcerolaReleaseCard, {
			props: {
				data: {
					item: { media: makeMedia(), entry: makeEntry(), manualWeekday: null },
					badge: 'Ep 7 · 14:30',
					subtitle: 'Assistindo'
				},
				events: { onOpen }
			}
		});

		expect(screen.getByRole('heading', { name: 'Sousou no Frieren' })).toBeInTheDocument();
		expect(screen.getByText('Ep 7 · 14:30')).toBeInTheDocument();
		expect(screen.getByText('Assistindo')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Escolher o dia|Pick the day/ })).toBeNull();

		await userEvent.setup().click(screen.getByRole('button', { name: 'Sousou no Frieren' }));
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it('escolhe um dia no seletor e volta a seguir o AniList', async () => {
		const user = userEvent.setup();
		const onPickDay = vi.fn();
		render(AcerolaReleaseCard, {
			props: {
				data: {
					item: {
						media: makeMedia({ mediaType: 'MANGA', nextAiringAt: null }),
						entry: makeEntry(),
						manualWeekday: 3
					}
				},
				events: { onPickDay }
			}
		});

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
