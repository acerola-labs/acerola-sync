<script module lang="ts">
	import type { ReleaseItem } from '$lib/api/types';

	export type AcerolaReleaseCardProps = {
		data: {
			item: ReleaseItem;
			/** Corner badge on the cover (e.g. "Ep 9 · 11:00"). */
			badge?: string | null;
			/** Line under the title (list state, chapter read…). */
			subtitle?: string | null;
		};
		events?: {
			onOpen?: () => void;
			/** Without `onPickDay`, the card has no day picker. `null` clears the chosen day. */
			onPickDay?: (weekday: number | null) => void;
		};
		ui?: {
			class?: string;
			busy?: boolean;
		};
	};
</script>

<script lang="ts">
	import AcerolaMediaCard from '$lib/components/acerola-media-card/acerola-media-card.svelte';
	import AcerolaPopover from '$lib/components/acerola-popover/acerola-popover.svelte';
	import { m } from '$lib/paraglide/messages';
	import { cn } from '$lib/utils/cn.utils';
	import { weekdayLabel } from '$lib/utils/labels.utils';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let { data, events, ui }: AcerolaReleaseCardProps = $props();

	let pickerOpen = $state(false);

	const media = $derived(data.item.media);
	const chosen = $derived(data.item.manualWeekday !== null);
	const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

	function pick(weekday: number | null) {
		pickerOpen = false;
		events?.onPickDay?.(weekday);
	}
</script>

<!-- The list's cover card with the airing time as badge, plus the day picker under it. -->
<div class={cn('flex flex-col gap-2', ui?.class)} data-release-card={media.id}>
	<AcerolaMediaCard
		data={{ media, entry: data.item.entry, badge: data.badge, subtitle: data.subtitle }}
		events={{ onOpen: events?.onOpen }}
	/>

	{#if events?.onPickDay}
		<AcerolaPopover
			state={{ open: pickerOpen }}
			events={{ onOpenChange: (open) => (pickerOpen = open) }}
			ui={{
				align: 'start',
				contentClass: 'w-56 rounded-card bg-card p-3 shadow-float ring-0'
			}}
		>
			{#snippet trigger()}
				<button
					type="button"
					class="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-surface px-2.5 text-[11px] font-bold transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60 {chosen
						? 'text-primary'
						: 'text-muted-foreground'}"
					disabled={ui?.busy}
					aria-label={m['sync.releases.day.pick']()}
					title={chosen ? m['sync.releases.chosen']() : m['sync.releases.day.pick']()}
					data-day-trigger
				>
					{#if chosen}
						<CalendarCheckIcon size={13} />
						{weekdayLabel(data.item.manualWeekday ?? 0)}
					{:else}
						<CalendarIcon size={13} />
						{m['sync.releases.day.pick']()}
					{/if}
				</button>
			{/snippet}
			{#snippet content()}
				<p class="mb-2 text-xs font-black tracking-tight">
					{m['sync.releases.day.title']()}
				</p>
				<div
					class="grid grid-cols-2 gap-1"
					role="listbox"
					aria-label={m['sync.releases.day.title']()}
				>
					{#each WEEKDAYS as weekday (weekday)}
						{@const active = data.item.manualWeekday === weekday}
						<button
							type="button"
							role="option"
							aria-selected={active}
							class="h-9 cursor-pointer rounded-full px-3 text-left text-xs font-bold transition-colors {active
								? 'bg-foreground text-background'
								: 'bg-surface text-muted-foreground hover:text-foreground'}"
							onclick={() => pick(weekday)}
						>
							{weekdayLabel(weekday)}
						</button>
					{/each}
					<button
						type="button"
						class="h-9 cursor-pointer rounded-full px-3 text-left text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => pick(null)}
					>
						{media.nextAiringAt
							? m['sync.releases.day.follow']()
							: m['sync.releases.day.clear']()}
					</button>
				</div>
			{/snippet}
		</AcerolaPopover>
	{/if}
</div>
