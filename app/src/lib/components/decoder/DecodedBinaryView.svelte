<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import Button from '../Button.svelte';
    import DownloadIcon from '../icons/DownloadIcon.svelte';
    import MidiPlayer from './MidiPlayer.svelte';
    import type { DecodeResult } from '@pixel-exchange-format/codec';
    import * as m from '$lib/paraglide/messages';

	const { result, onDownload, onReset }: {
		result: DecodeResult;
		onDownload: () => void;
		onReset: () => void;
	} = $props<{
		result: DecodeResult;
		onDownload: () => void;
		onReset: () => void;
	}>();

    let binaryAudioUrl = $state<string | null>(null);

    // Effect for binary audio preview
    $effect(() => {
        if (result && result.type === 'binary') {
            const ext = result.metadata.fn.split('.').pop()?.toLowerCase();
            const mimeTypes: Record<string, string> = {
                'flac': 'audio/flac',
                'ogg': 'audio/ogg',
                'oga': 'audio/ogg',
                'mp3': 'audio/mpeg',
                'opus': 'audio/opus'
            };
            const mimeType = mimeTypes[ext || ''];
            
            if (mimeType) {
                const blob = new Blob(
					[result.data as Uint8Array<ArrayBuffer>],
					{ type: mimeType }
				);
                const url = URL.createObjectURL(blob);
                binaryAudioUrl = url;
                return () => URL.revokeObjectURL(url);
            }
        }
        binaryAudioUrl = null;
    });

    function isMidiFile(filename: string): boolean {
        const lower = filename.toLowerCase();
        return lower.endsWith('.mid') || lower.endsWith('.midi') || lower.endsWith('.rmi') || lower.endsWith('.xmf') || lower.endsWith('.mxmf');
    }
</script>

{#if result && result.type === 'binary'}
	{#if isMidiFile(result.metadata.fn)}
		<MidiPlayer
			validChecksum={result.validChecksum}
			data={result.data}
			filename={result.metadata.fn}
			comment={result.metadata.comment}
			onClose={onReset}
		/>
	{:else}
		<div class="flex flex-col w-full h-full bg-gray-950">
			<!-- HEADER -->
			<div
				class="flex-none bg-gray-900 border-b border-gray-800 p-4 shadow-md flex justify-between items-center"
			>
				<h2
					class="text-sm font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2"
				>
					<span
						class="w-8 h-8 rounded bg-primary-900/30 text-primary-400 flex items-center justify-center"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke="currentColor"
							class="w-5 h-5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
							/>
						</svg>
					</span>
					{m.decoded_binary_title()}
				</h2>
				<!-- Integrity Badge -->
				<div
					class={`flex items-center gap-2 px-3 py-1 rounded text-xs font-bold border ${result.validChecksum ? 'bg-green-900/10 border-green-500/20 text-green-400' : 'bg-red-900/10 border-red-500/20 text-red-400'}`}
				>
					<span
						class={`w-2 h-2 rounded-full ${result.validChecksum ? 'bg-green-500' : 'bg-red-500'}`}
					></span>
					{result.validChecksum ? m.value_integrity_pass() : m.value_integrity_fail()}
				</div>
			</div>

			<!-- CONTENT -->
			<div class="grow p-8 overflow-y-auto">
				<div class="max-w-4xl mx-auto flex flex-col gap-2">
					<!-- File Info Grid -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
						<div class="bg-gray-900 border border-gray-800 rounded p-4">
							<span class="block text-gray-500 text-xs font-bold uppercase tracking-wider mb-2"
								>{m.label_filename()}</span
							>
							<span class="text-gray-200 text-sm break-all">{result.metadata.fn}</span>
						</div>
						<div class="bg-gray-900 border border-gray-800 rounded p-4">
							<span class="block text-gray-500 text-xs font-bold uppercase tracking-wider mb-2"
								>{m.label_size()}</span
							>
							<span class="font-mono text-gray-200 text-sm"
								>{(result.data.length / 1024).toFixed(2)} KB
								<span class="text-gray-500"
									>({result.data.length.toLocaleString()} {m.unit_bytes()})</span
								></span
							>
						</div>
					</div>

					<div class="bg-gray-900 border border-gray-800 rounded p-4">
						<span class="block text-gray-500 text-xs font-bold uppercase tracking-wider mb-2"
							>{m.label_comment()}</span
						>
						{#if result.metadata.comment}
							<span class="text-gray-300 text-sm whitespace-pre-wrap">{result.metadata.comment}</span>
						{:else}
							<span class="text-gray-300 text-sm">{m.val_none()}</span>
						{/if}
					</div>

					{#if binaryAudioUrl}
						<div class="bg-gray-900 border border-gray-800 rounded p-4">
							<span class="block text-gray-500 text-xs font-bold uppercase tracking-wider mb-2"
								>{m.section_audio_preview()}</span
							>
							<audio controls src={binaryAudioUrl} class="w-full h-8 outline-none dark-audio"
							></audio>
						</div>
					{/if}
				</div>
			</div>

			<!-- FOOTER -->
			<div class="flex-none bg-gray-850 p-4 border-t border-gray-700 flex justify-end">
				<Button onclick={onDownload} primary={true} class="shadow-lg shadow-primary-900/20">
					<DownloadIcon class="w-4 h-4 mr-2" />
					{m.btn_save_file()}
				</Button>
			</div>
		</div>
	{/if}
{/if}

<style>
    /* Styling for the audio element in dark mode */
    .dark-audio {
        filter: invert(1) hue-rotate(180deg) saturate(0.5);
    }
</style>
