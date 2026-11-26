<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { makeEntry, makeMedia } from '../../../../tests/fixtures/media';
	import AcerolaReleaseRow from './acerola-release-row.svelte';

	const { Story } = defineMeta({
		title: 'Sync/AcerolaReleaseRow',
		component: AcerolaReleaseRow,
		tags: ['autodocs']
	});
</script>

<Story name="Anime da semana" asChild>
	<div class="w-[400px]">
		<AcerolaReleaseRow
			data={{
				item: {
					media: makeMedia({ status: 'RELEASING', nextAiringEpisode: 7 }),
					entry: makeEntry({ progress: 6 }),
					manualWeekday: null
				},
				caption: 'Ep 7 · 14:30',
				detail: 'Ep 6 de 12'
			}}
			events={{ onPickDay: () => {} }}
		/>
	</div>
</Story>

<Story name="Fora da lista (temporada)" asChild>
	<div class="w-[400px]">
		<AcerolaReleaseRow
			data={{
				item: { media: makeMedia({ id: 2 }), entry: null, manualWeekday: null },
				caption: 'Ep 2 · 09:00'
			}}
		/>
	</div>
</Story>

<Story name="Mangá com dia escolhido" asChild>
	<div class="w-[400px]">
		<AcerolaReleaseRow
			data={{
				item: {
					media: makeMedia({ id: 3, mediaType: 'MANGA', titleUserPreferred: 'Dandadan' }),
					entry: makeEntry({ mediaId: 3, progress: 180 }),
					manualWeekday: 2
				},
				caption: 'Cap. 180 lido'
			}}
			events={{ onPickDay: () => {} }}
		/>
	</div>
</Story>
