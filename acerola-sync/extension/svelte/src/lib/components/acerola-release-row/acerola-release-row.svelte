<script module lang="ts">
	import type { ReleaseItem } from '$lib/api/types';

	export type AcerolaReleaseRowProps = {
		data: {
			item: ReleaseItem;
			/** Line under the title: airing time, chapter read… */
			caption: string;
			/** Second line, dimmer (e.g. "Ep 3 of 12"). */
			detail?: string | null;
		};
		events?: {
			onOpen?: () => void;
			/** Without `onPickDay`, the row has no day picker. `null` clears the chosen day. */
			onPickDay?: (weekday: number | null) => void;
		};
		ui?: {
			class?: string;
			busy?: boolean;
		};
	};
</script>

<script lang="ts">
	import AcerolaPopover from '$lib/components/acerola-popover/acerola-popover.svelte';
	import { m } from '$lib/paraglide/messages';
	import { cn } from '$lib/utils/cn.utils';
	import { statusLabel, weekdayLabel } from '$lib/utils/labels.utils';
	import { behindCount } from '$lib/utils/media.utils';
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ImageIcon from '@lucide/svelte/icons/image';

	let { data, events, ui }: AcerolaReleaseRowProps = $props();

	let pickerOpen = $state(false);

	const media = $derived(data.item.media);
	const entry = $derived(data.item.entry);
	const chosen = $derived(data.item.manualWeekday !== null);
	const behind = $derived(entry ? behindCount(entry, media) : 0);
	const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

	// Status chip: the "soft" tone of the entry's state; nothing on the list shows dimmed.
	const statusTone = $derived.by(() => {
		switch (entry?.status) {
			case 'CURRENT':
			case 'REPEATING':
				return 'bg-primary-soft text-primary';
			case 'PLANNING':
				return 'bg-info-soft text-info';
			case 'PAUSED':
				return 'bg-warning-soft text-warning';
			default:
				return 'bg-surface text-muted-foreground';
		}
	});

	function pick(weekday: number | null) {
		pickerOpen = false;
		events?.onPickDay?.(weekday);
	}
</script>

<!-- One title of the week: cover, title and time on the left; list state and day picker on the right. -->
<article
	class={cn(
		'flex items-center gap-3 rounded-tile p-2 transition-colors hover:bg-surface',
		ui?.class
	)}
	data-release-row={media.id}
>
	<button
		type="button"
		class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
		onclick={events?.onOpen}
		aria-label={media.titleUserPreferred}
	>
		<span
			class="relative h-20 w-14 flex-none overflow-hidden rounded-inner bg-surface shadow-lift"
			style={media.coverColor ? `background-color:${media.coverColor}` : undefined}
		>
			{#if media.coverUrl}
				<img
					src={media.coverUrl}
					alt=""
					loading="lazy"
					class="h-full w-full object-cover"
				/>
			{:else}
				<span class="flex h-full w-full items-center justify-center text-foreground/40">
					<ImageIcon size={20} />
				</span>
			{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="line-clamp-2 text-sm leading-tight font-bold"
				>{media.titleUserPreferred}</span
			>
			<span class="text-xs font-semibold text-foreground/80 tabular-nums">{data.caption}</span
			>
			{#if data.detail}
				<span class="truncate text-[11px] text-muted-foreground">{data.detail}</span>
			{/if}
		</span>
	</button>

	<div class="flex flex-none flex-col items-end gap-1.5">
		{#if behind > 0}
			<span
				class="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground"
			>
				{m['sync.card.behind']({ count: behind })}
			</span>
		{:else}
			<span class="rounded-full px-2 py-0.5 text-[10px] font-bold {statusTone}">
				{entry
					? statusLabel(entry.status, media.mediaType)
					: m['sync.releases.notListed']()}
			</span>
		{/if}

		{#if events?.onPickDay}
			<AcerolaPopover
				state={{ open: pickerOpen }}
				events={{ onOpenChange: (open) => (pickerOpen = open) }}
				ui={{
					align: 'end',
					contentClass: 'w-56 rounded-card bg-card p-3 shadow-float ring-0'
				}}
			>
				{#snippet trigger()}
					<button
						type="button"
						class="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-surface px-2.5 text-[11px] font-bold transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60 {chosen
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
</article>
