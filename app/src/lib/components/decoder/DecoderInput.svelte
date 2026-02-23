<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import type { AudioDecoderState } from '../../audioDecoder.svelte';
    import FileInput from '../FileInput.svelte';
    import * as m from '$lib/paraglide/messages';

    const { decoderState, imageFiles, onFileChange }: {
        decoderState: AudioDecoderState;
        imageFiles: File[];
        onFileChange: (event: Event) => void;
    } = $props<{
        decoderState: AudioDecoderState;
        imageFiles: File[];
        onFileChange: (event: Event) => void;
    }>();
</script>

<div class="grow flex flex-col items-center justify-center p-8 w-full h-full">
	<div
		class="w-full max-w-2xl border-4 border-black p-8 bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
	>
		<h2 class="text-3xl font-black uppercase mb-6 text-center">{m.decode_page_title()}</h2>
		<FileInput
			onChange={onFileChange}
			accept="image/png,image/jpeg"
			label={imageFiles.length > 0
				? m.decode_input_label_selected({
						fileCount: imageFiles.length
					})
				: m.decode_input_label_empty()}
			disabled={decoderState.isProcessing}
			multiple={true}
		/>
		{#if decoderState.isProcessing}
			<div class="mt-6 p-3 bg-yellow-300 border-2 border-black text-center font-bold animate-pulse">
				{m.status_reading_data()}
			</div>
		{/if}
		{#if decoderState.error}
			<div class="mt-6 p-3 bg-red-500 border-2 border-black text-white text-center font-bold">
				{decoderState.error}
			</div>
		{/if}
	</div>
</div>
