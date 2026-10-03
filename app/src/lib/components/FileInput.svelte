<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import UploadIcon from './icons/UploadIcon.svelte';

	let {
		onChange,
		accept,
		label,
		disabled = false,
		multiple = false
	}: {
		onChange: (event: Event) => void;
		accept?: string;
		label: string;
		disabled?: boolean;
		multiple?: boolean;
	} = $props();

	let input: HTMLInputElement;
	let isDragging = $state(false);

	function handleChange(event: Event) {
		onChange(event);
		// Allow re-selecting the same file
		input.value = '';
	}

	function handleDragOver(event: DragEvent) {
		if (disabled) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function handleDrop(event: DragEvent) {
		isDragging = false;
		if (disabled) return;
		event.preventDefault();
		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) return;

		const transfer = new DataTransfer();
		const limit = multiple ? files.length : 1;
		for (let i = 0; i < limit; i++) transfer.items.add(files[i]);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}
</script>

<label
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	class={`
  flex flex-col items-center justify-center w-full h-32 px-4
  border border-dashed border-gray-600 rounded
  cursor-pointer bg-gray-800/50 hover:bg-gray-800 hover:border-gray-500
  focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/40
  transition-all duration-200
  group
  ${isDragging ? 'bg-gray-800 border-primary-500' : ''}
  ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}
`}
>
	<div class="flex flex-col items-center justify-center pt-5 pb-6 text-center">
		<UploadIcon class="w-6 h-6 mb-2 text-gray-400 group-hover:text-gray-200" />
		<p class="text-sm font-medium text-gray-300 truncate max-w-full px-2">{label}</p>
		<p class="text-xs text-gray-500 mt-1 tracking-wider">{m.click_or_drop_file()}</p>
	</div>
	<input
		bind:this={input}
		type="file"
		class="sr-only"
		onchange={handleChange}
		{accept}
		{disabled}
		{multiple}
	/>
</label>
