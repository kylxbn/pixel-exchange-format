<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
	import { MAX_STRING_DATA_BYTES, MAX_METADATA_KEY_BYTES } from '@pixel-exchange-format/codec';
	import * as m from '$lib/paraglide/messages';

	interface MetadataEntry {
		key: string;
		value: string;
		systemManaged?: boolean;
	}

	interface Props {
		metadata: Array<MetadataEntry>;
		isProcessing: boolean;
		onStateChange?: (state: { isOverLimit: boolean; bytesRemaining: number }) => void;
	}

	let { metadata = $bindable(), isProcessing = false, onStateChange }: Props = $props();

	const maxBytes = MAX_STRING_DATA_BYTES;
	const encoder = new TextEncoder();

	// Derived state
	let bytesUsed = $derived.by(() => {
		let total = 1; // numPairs
		for (const entry of metadata) {
			total += 2 + encoder.encode(entry.key).length + encoder.encode(entry.value).length;
		}
		return total;
	});
	let bytesRemaining = $derived(maxBytes - bytesUsed);
	let hasInvalidKey = $derived(
		metadata.some((entry) => keyByteLength(entry.key) > MAX_METADATA_KEY_BYTES)
	);
	let isOverLimit = $derived(bytesRemaining < 0 || hasInvalidKey);

	// Notify parent of state changes
	$effect(() => {
		onStateChange?.({ isOverLimit, bytesRemaining });
	});

	function keyByteLength(key: string): number {
		return encoder.encode(key).length;
	}

	function addMetadataEntry() {
		// Generate a unique key
		let newKey = `key${metadata.length + 1}`;
		let counter = 1;
		while (metadata.some((entry) => entry.key === newKey)) {
			newKey = `key${metadata.length + 1}_${counter}`;
			counter++;
		}

		metadata.push({ key: newKey, value: '' });
		metadata = [...metadata];
	}

	function removeMetadataEntry(entry: MetadataEntry) {
		const index = metadata.indexOf(entry);
		metadata.splice(index, 1);
		metadata = [...metadata];
	}

	let originalKey = '';

	function onKeyFocus(entry: MetadataEntry) {
		originalKey = entry.key;
	}

	function validateKeyChange(entry: MetadataEntry, newKey: string) {
		// Prevent duplicate keys, empty keys, and reserved keys
		const trimmedKey = newKey.trim();
		if (
			!trimmedKey ||
			metadata.some((e) => e !== entry && e.key === trimmedKey) ||
			trimmedKey === 'fn'
		) {
			// Revert to original key if invalid
			entry.key = originalKey;
			metadata = [...metadata];
			return;
		}

		entry.key = trimmedKey;
		metadata = [...metadata];
	}
</script>

<!-- Metadata -->
<div>
	<div class="flex justify-between items-center mb-2">
		<div class="block font-medium text-xs text-gray-400 uppercase tracking-wide">
			{m.metadata_label()}
		</div>
		<div class="flex items-center gap-2">
			<span class={`text-xs uppercase font-bold ${isOverLimit ? 'text-red-500' : 'text-gray-400'}`}>
				{m.bytes_left({ count: bytesRemaining })}
			</span>
			<button
				type="button"
				onclick={addMetadataEntry}
				aria-label={m.aria_add_metadata()}
				class="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
				disabled={isProcessing}
			>
				+
			</button>
		</div>
	</div>

	<div class="flex flex-col gap-2 max-h-60">
		{#each metadata as entry (entry)}
			{@const keyTooLong = keyByteLength(entry.key) > MAX_METADATA_KEY_BYTES}
			<div class="flex flex-col gap-1">
				<div class="flex gap-2 items-center">
					<input
						type="text"
						bind:value={entry.key}
						placeholder={m.placeholder_key()}
						aria-invalid={keyTooLong}
						class={`flex-1 bg-gray-950 border text-gray-200 text-sm rounded px-2 py-1 disabled:opacity-50 focus:outline-none transition-colors min-w-0 ${keyTooLong ? 'border-red-700 focus:border-red-500' : 'border-gray-800 focus:border-primary-600'}`}
						disabled={isProcessing || entry.systemManaged}
						onfocus={() => onKeyFocus(entry)}
						onblur={() => validateKeyChange(entry, entry.key)}
					/>
					<input
						type="text"
						bind:value={entry.value}
						placeholder={m.placeholder_value()}
						class="flex-2 bg-gray-950 border border-gray-800 text-gray-200 text-sm rounded px-2 py-1 disabled:opacity-50 focus:outline-none focus:border-primary-600 transition-colors min-w-0"
						disabled={isProcessing}
					/>
					<button
						type="button"
						onclick={() => removeMetadataEntry(entry)}
						aria-label={m.aria_remove_metadata()}
						class="text-red-400 hover:text-red-300 px-2 py-1"
						disabled={isProcessing || entry.systemManaged}
					>
						×
					</button>
				</div>
				{#if keyTooLong}
					<p class="text-[11px] text-red-400">
						{m.error_key_too_long({ max: MAX_METADATA_KEY_BYTES })}
					</p>
				{/if}
			</div>
		{/each}
	</div>
</div>
