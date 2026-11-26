import { describe, expect, it } from 'vitest';
import {
	dateOfWeekday,
	daysUntil,
	groupByWeekday,
	orderedWeekdays,
	releaseWeekday,
	weekdayInSaoPaulo
} from './week.utils';

// 2026-11-26 is a Thursday.
const THURSDAY_NOON = Date.parse('2026-11-26T15:00:00Z');

function item(title: string, nextAiringAt: string | null, manualWeekday: number | null = null) {
	return { manualWeekday, media: { titleUserPreferred: title, nextAiringAt } };
}

describe('week.utils', () => {
	it('lê o dia da semana no horário de Brasília', () => {
		// 01:00 UTC on Friday is still Thursday night in Brasília.
		expect(weekdayInSaoPaulo('2026-11-27T01:00:00Z')).toBe(4);
		expect(weekdayInSaoPaulo('2026-11-27T04:00:00Z')).toBe(5);
	});

	it('o dia escolhido vence o horário do AniList; sem nenhum, não tem dia', () => {
		expect(releaseWeekday(item('a', '2026-11-27T04:00:00Z'))).toBe(5);
		expect(releaseWeekday(item('a', '2026-11-27T04:00:00Z', 1))).toBe(1);
		expect(releaseWeekday(item('a', null))).toBeNull();
	});

	it('ordena a semana a partir de hoje', () => {
		expect(orderedWeekdays(4)).toEqual([4, 5, 6, 0, 1, 2, 3]);
		expect(daysUntil(4, 4)).toBe(0);
		expect(daysUntil(0, 4)).toBe(3);
		expect(weekdayInSaoPaulo(dateOfWeekday(0, THURSDAY_NOON))).toBe(0);
	});

	it('agrupa por dia, hoje primeiro, sem dia por último, e por horário dentro do dia', () => {
		const groups = groupByWeekday(
			[
				item('Sem dia', null),
				item('Sábado tarde', '2026-11-28T20:00:00Z'),
				item('Quinta', '2026-11-26T22:00:00Z'),
				item('Sábado manhã', '2026-11-28T12:00:00Z'),
				item('Escolhido domingo', null, 0)
			],
			THURSDAY_NOON
		);
		expect(groups.map((group) => group.weekday)).toEqual([4, 6, 0, null]);
		expect(groups[1].items.map((entry) => entry.media.titleUserPreferred)).toEqual([
			'Sábado manhã',
			'Sábado tarde'
		]);
		expect(groups[3].items[0].media.titleUserPreferred).toBe('Sem dia');
	});
});
