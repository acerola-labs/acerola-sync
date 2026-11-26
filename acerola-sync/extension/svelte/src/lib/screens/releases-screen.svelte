<script lang="ts">
	import type { MediaType, ReleaseItem } from '$lib/api/types';
	import AcerolaChipTabs from '$lib/components/acerola-chip-tabs/acerola-chip-tabs.svelte';
	import AcerolaEmptyState from '$lib/components/acerola-empty-state/acerola-empty-state.svelte';
	import AcerolaReleaseRow from '$lib/components/acerola-release-row/acerola-release-row.svelte';
	import AcerolaSection from '$lib/components/acerola-section/acerola-section.svelte';
	import { m } from '$lib/paraglide/messages';
	import { app } from '$lib/state/app.svelte';
	import { seasonLabel, weekdayLabel } from '$lib/utils/labels.utils';
	import { totalUnits } from '$lib/utils/media.utils';
	import { staggerIn } from '$lib/utils/motion.utils';
	import { slidingIndicator } from '$lib/utils/sliding-indicator.utils';
	import { formatTimeOfDay, formatDayMonth } from '$lib/utils/time.utils';
	import {
		dateOfWeekday,
		daysUntil,
		groupByWeekday,
		weekdayInSaoPaulo
	} from '$lib/utils/week.utils';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	// The week, in Brasília time: every title on the day it lands, today first. Anime comes from
	// the AniList airing time (or the whole season); manga and anime with no time get the day
	// you choose. The server mirrors the season once a day, so this screen costs no request.

	type Scope = 'mine' | 'season';
	const FOLLOWED = ['CURRENT', 'REPEATING', 'PLANNING', 'PAUSED'];

	let mediaType = $state<MediaType>('ANIME');
	let scope = $state<Scope>('mine');
	let items = $state<ReleaseItem[]>([]);
	let loading = $state(true);
	let busyIds = $state<number[]>([]);

	const page = $derived(app.mode === 'page');
	const now = Date.now();
	const today = weekdayInSaoPaulo(now);
	const season = $derived.by(() => {
		const month = Number(
			new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/Sao_Paulo',
				month: 'numeric'
			}).format(now)
		);
		const year = Number(
			new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/Sao_Paulo',
				year: 'numeric'
			}).format(now)
		);
		const name = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
		return { name, year };
	});
	const shown = $derived(
		mediaType === 'MANGA' || scope === 'season'
			? items
			: items.filter((item) => item.entry && FOLLOWED.includes(item.entry.status))
	);
	const groups = $derived(groupByWeekday(shown, now));

	async function load() {
		if (!app.api) return;
		loading = true;
		const requested = mediaType;
		try {
			const next = await app.api.releasesWeek(requested);
			// Type changed while loading: the newest response wins.
			if (requested === mediaType) items = next;
		} catch (error) {
			await app.failScreen(error);
		} finally {
			if (requested === mediaType) loading = false;
		}
	}

	function selectType(next: MediaType) {
		if (next === mediaType) return;
		mediaType = next;
		items = [];
		void load();
	}

	async function pickDay(item: ReleaseItem, weekday: number | null) {
		if (!app.api || busyIds.includes(item.media.id)) return;
		busyIds = [...busyIds, item.media.id];
		try {
			await app.api.saveReleaseDay(item.media.id, weekday);
			items = items.map((other) =>
				other.media.id === item.media.id ? { ...other, manualWeekday: weekday } : other
			);
			toast.success(
				weekday === null ? m['sync.releases.day.cleared']() : m['sync.releases.day.saved']()
			);
		} catch (error) {
			await app.handleError(error);
		} finally {
			busyIds = busyIds.filter((id) => id !== item.media.id);
		}
	}

	function caption(item: ReleaseItem) {
		const { media, entry } = item;
		if (media.mediaType === 'ANIME') {
			return media.nextAiringEpisode && media.nextAiringAt
				? m['sync.releases.caption.episode']({
						episode: media.nextAiringEpisode,
						time: formatTimeOfDay(media.nextAiringAt)
					})
				: [media.format, media.seasonYear].filter(Boolean).join(' · ');
		}
		return entry && entry.progress > 0
			? m['sync.releases.caption.chapter']({ progress: entry.progress })
			: m['sync.releases.caption.chapterNone']();
	}

	function detail(item: ReleaseItem) {
		const { media, entry } = item;
		if (!entry || media.mediaType !== 'ANIME') return null;
		return m['sync.home.caption.episode']({
			progress: entry.progress,
			total: totalUnits(media) ?? '?'
		});
	}

	function dayHint(weekday: number | null, count: number) {
		const amount =
			count === 1 ? m['sync.releases.countOne']() : m['sync.releases.count']({ count });
		if (weekday === null) return m['sync.releases.noDay.hint']();
		const distance = daysUntil(weekday, today);
		const when =
			distance === 0
				? m['sync.releases.today']()
				: distance === 1
					? m['sync.releases.tomorrow']()
					: formatDayMonth(dateOfWeekday(weekday, now));
		return `${when} · ${amount}`;
	}

	onMount(() => void load());
</script>

<div class="flex flex-col gap-5 pb-4">
	<header class="flex flex-col gap-1">
		<p class="text-xs font-semibold text-muted-foreground">{m['sync.releases.eyebrow']()}</p>
		<!-- Same two big words as the list: the type is the title, and switching slides the bar. -->
		<div
			class="isolate flex items-baseline gap-4 self-start pb-2.5"
			role="tablist"
			aria-label={m['sync.releases.type.label']()}
			use:slidingIndicator={{
				selector: '[aria-selected="true"]',
				indicatorClass: 'top-auto bottom-0 h-1.5 rounded-full bg-primary',
				track: ['x', 'width']
			}}
		>
			{#each ['ANIME', 'MANGA'] as const as type (type)}
				<button
					type="button"
					role="tab"
					aria-selected={mediaType === type}
					onclick={() => selectType(type)}
					class="cursor-pointer leading-none font-black tracking-tighter transition-colors {page
						? 'text-6xl'
						: 'text-[44px]'} {mediaType === type
						? 'text-foreground'
						: 'text-muted-foreground/40 hover:text-muted-foreground/80'}"
				>
					{type === 'ANIME' ? m['sync.media.type.anime']() : m['sync.media.type.manga']()}
				</button>
			{/each}
		</div>
	</header>

	{#if mediaType === 'ANIME'}
		<AcerolaChipTabs
			data={{
				items: [
					{ id: 'mine', label: m['sync.releases.scope.mine']() },
					{
						id: 'season',
						label: m['sync.releases.scope.season']({
							season: seasonLabel(season.name),
							year: season.year
						})
					}
				],
				active: scope
			}}
			events={{ onSelect: (id) => (scope = id as Scope) }}
			ui={{ size: 'sm', label: m['sync.releases.scope.label']() }}
		/>
	{/if}

	{#if loading}
		<div class="flex flex-col gap-3" aria-busy="true">
			{#each [0, 1, 2] as index (index)}
				<div class="h-24 animate-pulse rounded-tile bg-surface"></div>
			{/each}
		</div>
	{:else if groups.length === 0}
		<AcerolaEmptyState
			data={{
				title: m['sync.releases.empty.label'](),
				hint: m['sync.releases.empty.hint']()
			}}
		/>
	{:else}
		<div class="flex flex-col gap-6" use:staggerIn={{ key: `${mediaType}-${scope}` }}>
			{#each groups as group (group.weekday ?? 'none')}
				<AcerolaSection
					data={{
						title:
							group.weekday === null
								? m['sync.releases.noDay.label']()
								: weekdayLabel(group.weekday),
						hint: dayHint(group.weekday, group.items.length)
					}}
					ui={{ class: group.weekday === today ? 'rounded-card bg-card p-3' : '' }}
				>
					<ol class="flex flex-col gap-1" data-weekday={group.weekday ?? 'none'}>
						{#each group.items as item (item.media.id)}
							<li>
								<AcerolaReleaseRow
									data={{ item, caption: caption(item), detail: detail(item) }}
									events={{
										onOpen: () =>
											app.push({ name: 'media', mediaId: item.media.id }),
										onPickDay: item.entry
											? (weekday) => pickDay(item, weekday)
											: undefined
									}}
									ui={{ busy: busyIds.includes(item.media.id) }}
								/>
							</li>
						{/each}
					</ol>
				</AcerolaSection>
			{/each}
		</div>
	{/if}
</div>
