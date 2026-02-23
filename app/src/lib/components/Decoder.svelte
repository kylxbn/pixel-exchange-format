<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import { AudioDecoderState } from '../audioDecoder.svelte';
    import { encodeWav } from '../constants';
    import DecodedBinaryView from './decoder/DecodedBinaryView.svelte';
    import DecodedAudioView from './decoder/DecodedAudioView.svelte';
    import FileInput from './FileInput.svelte';
    import Button from './Button.svelte';
    import * as m from '$lib/paraglide/messages';

    let { initialFiles, onFilesProcessed }: {
        initialFiles?: File[];
        onFilesProcessed?: () => void;
    } = $props<{
        initialFiles?: File[];
        onFilesProcessed?: () => void;
    }>();

    const decoderState = new AudioDecoderState();
    
    let imageFiles = $state<File[]>([]);
    let imagePreviewUrls = $state<string[]>([]);
    let isSaving = $state(false);

    // Effect for initial files
    $effect(() => {
        if (initialFiles && initialFiles.length > 0) {
            imageFiles = initialFiles;
            decoderState.processImages(initialFiles);
            if (onFilesProcessed) onFilesProcessed();
        }
    });

    // Effect for image previews
    $effect(() => {
        if (decoderState.result && imageFiles.length > 0) {
            const urls: string[] = [];
            
            if (decoderState.result.type === 'audio') {
                // For audio, show all source images
                const sources = (decoderState.result as any).decoder.sources;
                for (let i = 0; i < sources.length; i++) {
                    const source = sources[i];
                    // For stereo, only show mid channel; for mono, show mono channel
                    if (source.channelMode === 0 || source.channelMode === 1) { // MONO or STEREO_MID
                        if (imageFiles[i]) {
                            urls.push(URL.createObjectURL(imageFiles[i]));
                        }
                    }
                }
            } else {
                // For binary, show first image
                if (imageFiles[0]) {
                    urls.push(URL.createObjectURL(imageFiles[0]));
                }
            }
            
            imagePreviewUrls = urls;
            
            return () => {
                urls.forEach(url => URL.revokeObjectURL(url));
            };
        }
    });

    async function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        if (files && files.length > 0) {
            const fileArray = Array.from(files);
            imageFiles = fileArray;
            imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
            imagePreviewUrls = [];
            try {
                await decoderState.processImages(files);
            } catch (e) {
                console.error('Decoder: processImages error', e);
            }
        }
    }

    async function handleDownload() {
        if (!decoderState.result) return;
        isSaving = true;
        await new Promise(r => setTimeout(r, 10));
        try {
            let blob: Blob;
            let filename = decoderState.result.metadata.fn;
            if (decoderState.result.type === 'audio') {
                const decoded = (decoderState.result as any).decoder.decodeAll();
                const wavData = encodeWav(decoded.channels, decoded.sampleRate) as any;
                blob = new Blob([wavData], { type: 'audio/wav' });
                filename = filename ? (filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`) : 'decoded_audio.wav';
            } else {
                const binaryData = new Uint8Array(decoderState.result.data);
                blob = new Blob([binaryData]);
                filename = filename || "decoded_file.bin";
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(m.alert_failed_to_generate());
        } finally {
            isSaving = false;
        }
    }

    function handleReset() {
        imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
        imagePreviewUrls = [];
        imageFiles = [];
        decoderState.reset();
    }
</script>

<div class="grid grid-cols-[minmax(200px,360px)_minmax(1024px,1fr)] h-full w-full overflow-hidden">
	<!-- LEFT PANEL: Controls -->
	<div
		class="bg-gray-900 border-r border-gray-800 flex flex-col z-20 shadow-lg"
	>
		<div class="p-6 flex flex-col h-full">
			<h2 class="text-lg font-bold text-gray-100 mb-6">{m.decode_page_title()}</h2>

			<div class="flex flex-col gap-6 grow">
				<div>
					<div class="block mb-2 font-medium text-xs text-gray-400 uppercase tracking-wide">
						{imageFiles.length > 0 ? m.label_selected_input() : m.input_source_label()}
					</div>
					<FileInput
						onChange={handleFileChange}
						accept="image/png,image/jpeg"
						label={imageFiles.length > 0
							? m.decode_input_label_selected({
									fileCount: imageFiles.length,
								})
							: m.decode_input_label_empty()}
						disabled={decoderState.isProcessing}
						multiple={true}
					/>
				</div>

				{#if decoderState.isProcessing}
					<div
						class="mt-4 p-4 bg-primary-900/20 border border-primary-800 rounded flex flex-col items-center gap-2 animate-pulse"
					>
						<div
							class="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"
						></div>
						<span class="text-xs font-bold text-primary-300 uppercase tracking-wider"
							>{m.status_reading_data()}</span
						>
					</div>
				{/if}

				{#if decoderState.error}
					<div class="mt-4 p-4 bg-red-900/20 border border-red-800 rounded">
						<span>{m.label_error()}</span>
						<p class="text-xs text-red-200">{decoderState.error}</p>
					</div>
				{/if}

                {#if decoderState.optimizedDecode}
                    <div class="mt-4 p-4 bg-green-900/20 border border-green-800 rounded flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-green-400">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        <span class="text-xs font-bold text-green-300 uppercase tracking-wider">Optimized decode</span>
                    </div>
                {/if}
			</div>

			<!-- Footer of Left Panel -->
			{#if decoderState.result}
				<div class="mt-auto pt-6 border-t border-gray-700">
					<Button onclick={handleReset} variant="secondary" class="w-full">
						{m.btn_close()}
					</Button>
				</div>
			{/if}
		</div>
	</div>

	<!-- RIGHT PANEL: Output -->
	<div class="grow bg-gray-950 relative overflow-hidden flex flex-col">
		{#if !decoderState.result}
			<div
				class="w-full h-full flex flex-col space-y-2 items-center justify-center text-gray-500 select-none"
			>
				<div class="size-24 rounded-full bg-gray-800/50 flex items-center justify-center mb-4">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke="currentColor"
						class="size-10"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
						/>
					</svg>
				</div>
				<p class="text-gray-400 text-sm font-medium">{m.msg_no_content()}</p>
				<p class="text-gray-500 text-xs mt-1">{m.msg_select_encoded_image()}</p>
			</div>
		{:else if decoderState.result.type === 'binary'}
			<DecodedBinaryView
				result={decoderState.result}
				onDownload={handleDownload}
				onReset={handleReset}
			/>
		{:else}
			<DecodedAudioView
				{decoderState}
				imagePreviewUrls={imagePreviewUrls}
				{isSaving}
				onDownload={handleDownload}
				onReset={handleReset}
			/>
		{/if}
	</div>
</div>
