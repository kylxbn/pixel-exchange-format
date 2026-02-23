<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import { AudioEncoderState } from '../audioEncoder.svelte';
    import FileInput from './FileInput.svelte';
    import Button from './Button.svelte';
    import MetadataInput from './MetadataInput.svelte';
    import DownloadIcon from './icons/DownloadIcon.svelte';
    import ArrowRightIcon from './icons/ArrowRightIcon.svelte';
    import { calculateMaxSamplesPerImage, getWavMetadata } from '../constants';
    import { transcodeViaFacebook } from '$lib/facebookRoundtrip';
    import { env } from '$env/dynamic/public';
    import * as m from '$lib/paraglide/messages';

    let { onTransfer } = $props();

    const encoderState = new AudioEncoderState();

    type MetadataEntry = {
        key: string;
        value: string;
        systemManaged?: boolean;
    };

    let sourceFile = $state<File | null>(null);
    let metadata = $state<Array<MetadataEntry>>([]);
    let detectedSampleRate = $state<number | null>(null);
    let detectedTotalSamples = $state<number | null>(null);
    let detectedChannels = $state<number | null>(null);
    let detectedDuration = $state<number | null>(null);
    let targetSampleRate = $state<string>('');
    let isOverLimit = $state(false);
    let forceMono = $state(false);
    let isFacebookTranscoding = $state(false);
    let facebookStatus = $state<string | null>(null);
    let facebookError = $state<string | null>(null);

    function parseBooleanValue(value: string | undefined, fallback: boolean): boolean {
        if (!value) return fallback;
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return fallback;
    }

    function getEffectiveSampleRate(): number | null {
        const parsed = Number(targetSampleRate);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        return detectedSampleRate;
    }

    function getDetectedDuration(): number | null {
        if (detectedDuration !== null) return detectedDuration;
        if (!detectedSampleRate || !detectedTotalSamples) return null;
        const duration = detectedTotalSamples / detectedSampleRate;
        if (!Number.isFinite(duration) || duration <= 0) return null;
        return duration;
    }

    function getRecommendedSampleRate(): number | null {
        const duration = getDetectedDuration();
        if (!detectedSampleRate || !duration) return null;
        const maxSamples = calculateMaxSamplesPerImage();
        const rate = Math.floor(maxSamples / duration);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return Math.min(detectedSampleRate, rate);
    }

    function getEstimatedSamplesAtTargetRate(): number | null {
        const duration = getDetectedDuration();
        const rate = getEffectiveSampleRate();
        if (!duration || !rate) return null;
        return Math.ceil(duration * rate);
    }

    function getFitsInOneChunk(): boolean {
        const estimated = getEstimatedSamplesAtTargetRate();
        if (!estimated) return false;
        return estimated <= calculateMaxSamplesPerImage();
    }

    // Initialize filename when file is selected
    $effect(() => {
        if (sourceFile) {
            const filenameEntry = metadata.find(e => e.key === 'fn');
            if (!filenameEntry) {
                metadata.push({key: 'fn', value: sourceFile.name, systemManaged: true});
                metadata = [...metadata];
            } else {
                filenameEntry.value = sourceFile.name;
            }
        }
    });

    function handleMetadataStateChange(state: { isOverLimit: boolean; bytesRemaining: number }) {
        isOverLimit = state.isOverLimit;
    }

    function handleProcess() {
        if (sourceFile && !isOverLimit) {
            facebookError = null;
            facebookStatus = null;
            // Validate no duplicate keys exist
            const keys = metadata.map(e => e.key);
            if (keys.length !== new Set(keys).size) {
                // Duplicate keys found, don't process
                return;
            }

            const targetRate = targetSampleRate ? parseInt(targetSampleRate) : undefined;
            encoderState.processAudio(
                sourceFile,
                Object.fromEntries(metadata.map(e => [e.key, e.value])),
                targetRate,
                forceMono
            );
        }
    }

    async function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            sourceFile = file;

            // Detect sample rate if WAV
            detectedSampleRate = null;
            detectedTotalSamples = null;
            detectedChannels = null;
            detectedDuration = null;
            forceMono = false;
            targetSampleRate = '';
            if (file.type.startsWith('audio/') || file.type === '') {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const wavMetadata = getWavMetadata(arrayBuffer);
                    if (wavMetadata) {
                        detectedSampleRate = wavMetadata.sampleRate;
                        detectedTotalSamples = wavMetadata.totalSamples;
                        detectedChannels = wavMetadata.numberOfChannels;
                        targetSampleRate = wavMetadata.sampleRate.toString();
                    }

                    try {
                        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                        const audioCtx = new AudioContextClass();
                        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
                        detectedDuration = audioBuffer.duration;
                        detectedChannels = audioBuffer.numberOfChannels;
                        if (!detectedSampleRate) {
                            detectedSampleRate = audioBuffer.sampleRate;
                            targetSampleRate = audioBuffer.sampleRate.toString();
                        }
                        if (detectedSampleRate) {
                            detectedTotalSamples = Math.round(audioBuffer.duration * detectedSampleRate);
                        }
                        if (audioCtx.state !== 'closed') await audioCtx.close();
                    } catch (e) {
                        // Ignore decode errors, fallback to WAV header metadata
                    }
                } catch (e) {
                    // Ignore errors, just don't set sample rate
                }
            }

            const filenameEntry = metadata.find(e => e.key === 'fn');
            if (filenameEntry) {
                filenameEntry.value = file.name;
            } else {
                metadata.push({key: 'fn', value: file.name});
                metadata = [...metadata];
            }
        }
    }

    function handleFitToChunk() {
        const rate = getRecommendedSampleRate();
        if (!rate) return;
        targetSampleRate = rate.toString();
    }

    function formatNumber(value: unknown, digits: number): string {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
        return value.toFixed(digits);
    }


    function handleDownload(imageUrl: string, downloadName: string) {
        if (!imageUrl) return;
        const link = document.createElement('a');
        link.download = downloadName;
        link.href = imageUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    function handleTransferClick() {
        if (encoderState.images.length === 0) return;

        const files: File[] = encoderState.images.map(img => new File([img.blob], img.name, {type: 'image/png'}));

        onTransfer(files);
    }

    async function handleFacebookTranscodeThenDecode() {
        if (encoderState.images.length === 0 || isFacebookTranscoding) return;

        facebookError = null;
        facebookStatus = null;

        const pageId = env.PUBLIC_FACEBOOK_PAGE_ID;
        const accessToken = env.PUBLIC_FACEBOOK_PAGE_ACCESS_TOKEN;
        const appId = env.PUBLIC_FACEBOOK_APP_ID;
        const appSecret = env.PUBLIC_FACEBOOK_APP_SECRET;
        const userAccessToken = env.PUBLIC_FACEBOOK_USER_ACCESS_TOKEN;
        const postMessage = env.PUBLIC_FACEBOOK_POST_MESSAGE;
        const deleteAfterRoundtrip = parseBooleanValue(env.PUBLIC_FACEBOOK_DELETE_AFTER_ROUNDTRIP, true);

        const hasDirectPageToken = Boolean(accessToken);
        const hasAppCredentialFlow = Boolean(appId && appSecret && userAccessToken);

        if (!pageId || (!hasDirectPageToken && !hasAppCredentialFlow)) {
            facebookError =
                'Facebook env vars are missing. Set PUBLIC_FACEBOOK_PAGE_ID and either PUBLIC_FACEBOOK_PAGE_ACCESS_TOKEN or PUBLIC_FACEBOOK_APP_ID + PUBLIC_FACEBOOK_APP_SECRET + PUBLIC_FACEBOOK_USER_ACCESS_TOKEN.';
            return;
        }

        isFacebookTranscoding = true;
        try {
            const files = await transcodeViaFacebook(
                encoderState.images.map(image => ({
                    name: image.name,
                    blob: image.blob
                })),
                {
                    pageId,
                    pageAccessToken: accessToken || '',
                    appId: appId || undefined,
                    appSecret: appSecret || undefined,
                    userAccessToken: userAccessToken || undefined,
                    postMessage: postMessage || undefined,
                    deleteAfterRoundtrip,
                    onProgress: status => {
                        facebookStatus = status;
                    }
                }
            );

            facebookStatus = 'Sending transcoded image(s) to decoder...';
            onTransfer(files);
        } catch (error) {
            facebookError =
                error instanceof Error
                    ? error.message
                    : 'Facebook transcode failed. Please verify the token and page configuration.';
        } finally {
            isFacebookTranscoding = false;
            if (!facebookError) {
                facebookStatus = null;
            }
        }
    }

    function handleDownloadAll() {
        if (encoderState.images.length === 0) return;

        for (const image of encoderState.images) {
            handleDownload(URL.createObjectURL(image.blob), image.name);
        }
    }
</script>

<div class="flex h-full w-full overflow-hidden">
	<!-- LEFT PANEL: Controls -->
	<div
		class="w-90 flex-none bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto"
	>
		<div class="p-6">
			<h2 class="text-lg font-bold text-gray-100 mb-6">{m.encode_page_title()}</h2>

			<div class="flex flex-col gap-6">
				<!-- Source Input -->
				<div>
					<div class="block mb-2 font-medium text-xs text-gray-400 uppercase tracking-wide">
						{m.input_source_label()}
					</div>
					<FileInput
						onChange={handleFileChange}
						accept="*"
						label={sourceFile ? sourceFile.name : m.input_file_placeholder()}
						disabled={encoderState.isProcessing}
					/>
				</div>

				<!-- Sample Rate (only for WAV files) -->
				{#if detectedSampleRate !== null}
					<div>
						<div class="block mb-2 font-medium text-xs text-gray-400 uppercase tracking-wide">
							Sample Rate (Hz)
						</div>
						<input
							type="number"
							bind:value={targetSampleRate}
							placeholder="Sample Rate"
							min="1"
							class="w-full bg-gray-950 border border-gray-800 text-gray-200 text-sm rounded px-2 py-1 disabled:opacity-50 focus:outline-none focus:border-primary-600 transition-colors"
							disabled={encoderState.isProcessing}
						/>
						{#if (detectedChannels ?? 0) > 1}
							<label class="mt-2 flex items-center gap-2 text-xs text-gray-400">
								<input
									type="checkbox"
									bind:checked={forceMono}
									disabled={encoderState.isProcessing}
									class="accent-primary-600"
								/>
								<span>Force mono (downmix)</span>
							</label>
						{/if}
						<div class="mt-2 flex items-center gap-2">
							<button
								type="button"
								onclick={handleFitToChunk}
								disabled={!getRecommendedSampleRate() ||
									getFitsInOneChunk() ||
									encoderState.isProcessing}
								class="text-xs font-medium bg-gray-800 text-gray-200 px-2 py-1 rounded border border-gray-700 hover:bg-gray-700 hover:border-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
							>
								Fit to 1 chunk
							</button>
							{#if getFitsInOneChunk()}
								<span class="text-xs text-gray-500">Already fits in 1 chunk.</span>
							{:else if getRecommendedSampleRate()}
								<span class="text-xs text-gray-500">Suggested: {getRecommendedSampleRate()} Hz</span
								>
							{/if}
						</div>
						<div class="mt-2 text-[11px] text-gray-500">
							{#if detectedSampleRate && detectedTotalSamples}
								<span>
									Duration: {formatNumber(getDetectedDuration(), 2)} s | Samples/ch: {detectedTotalSamples}
								</span>
							{:else}
								<span>Duration: n/a | Samples/ch: n/a</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Metadata -->
				<MetadataInput
					bind:metadata
					isProcessing={encoderState.isProcessing}
					onStateChange={handleMetadataStateChange}
				/>

				<!-- Action -->
				<div>
					<Button
						onclick={handleProcess}
						disabled={!sourceFile || encoderState.isProcessing || isOverLimit}
						class="w-full relative overflow-hidden h-10"
						variant="primary"
					>
						{#if encoderState.isProcessing}
							<div class="relative z-10 flex items-center justify-center gap-2">
								<span>{m.btn_encoding({ progress: Math.round(encoderState.progress) })}</span>
							</div>
							<div
								class="absolute left-0 top-0 h-full bg-primary-700/50 transition-all duration-300 ease-out"
								style={`width: ${encoderState.progress}%`}
							></div>
						{:else}
							{m.btn_encode()}
						{/if}
					</Button>

					{#if encoderState.error}
						<div class="mt-4 p-3 bg-red-900/30 border border-red-800 text-red-200 text-xs rounded">
							{m.error_prefix({ error: encoderState.error })}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- RIGHT PANEL: Output -->
	<div class="grow bg-gray-950 p-6 overflow-y-auto">
		<div class="flex justify-between items-center mb-6">
			<h3 class="text-sm font-bold text-gray-300 uppercase tracking-wider">
				{m.output_images_title()}
			</h3>
			{#if encoderState.images.length > 0}
				<div class="flex flex-col items-end gap-2">
					<div class="flex items-center gap-2">
						<button
							onclick={handleDownloadAll}
							disabled={isFacebookTranscoding}
							class="flex items-center gap-2 text-xs font-medium bg-gray-800 text-gray-200 px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-700 hover:border-gray-600 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<span>Download all</span>
							<DownloadIcon class="w-3 h-3" />
						</button>
                        <!--
						<button
							onclick={handleFacebookTranscodeThenDecode}
							disabled={isFacebookTranscoding}
							class="flex items-center gap-2 text-xs font-medium bg-gray-800 text-gray-200 px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-700 hover:border-gray-600 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<span
								>{isFacebookTranscoding
									? 'Facebook roundtrip...'
									: 'Facebook Transcode then Decode'}</span
							>
						</button>
                        -->
						<button
							onclick={handleTransferClick}
							disabled={isFacebookTranscoding}
							class="flex items-center gap-2 text-xs font-medium bg-gray-800 text-gray-200 px-3 py-1.5 rounded border border-gray-700 hover:bg-gray-700 hover:border-gray-600 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<span>{m.btn_send_to_decoder()}</span>
							<ArrowRightIcon class="w-3 h-3" />
						</button>
					</div>
					{#if facebookStatus}
						<p class="text-[11px] text-gray-500">{facebookStatus}</p>
					{/if}
					{#if facebookError}
						<p class="text-[11px] text-red-400">{facebookError}</p>
					{/if}
				</div>
			{/if}
		</div>

		{#if encoderState.images.length === 0}
			<div
				class="h-[calc(100%-4rem)] border border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-gray-400 space-y-2 select-none"
			>
				<div class="size-24 rounded-full bg-gray-800/50 flex items-center justify-center mb-4">
					<DownloadIcon class="size-10 text-gray-500" />
				</div>
				<p class="text-gray-400 text-sm font-medium">{m.msg_encoded_images_placeholder()}</p>
				<p class="text-gray-500 text-xs mt-1 max-w-xs text-center">
					{m.msg_encoded_output_placeholder()}
				</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
				{#each encoderState.images as image, index}
					<div
						class="bg-gray-800 border border-gray-700 rounded-md shadow-sm overflow-hidden flex flex-col group"
					>
						<div
							class="aspect-square w-full bg-gray-950 flex items-center justify-center overflow-hidden relative"
						>
							<!-- Checkerboard pattern for transparency indication -->
							<div
								class="absolute inset-0 opacity-10"
								style="background-image: radial-gradient(#4b5563 1px, transparent 1px); background-size: 10px 10px;"
							></div>
							<img
								src={URL.createObjectURL(image.blob)}
								alt="Encoded"
								class="max-w-full max-h-full object-contain image-pixelated relative z-10"
								style="image-rendering: pixelsated"
							/>

							<div
								class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20"
							>
								<Button
									onclick={() => handleDownload(URL.createObjectURL(image.blob), image.name)}
									class="p-2! h-8 w-8 rounded-full! bg-gray-900/80! backdrop-blur-sm border-gray-600"
								>
									<DownloadIcon class="w-4 h-4" />
								</Button>
							</div>
						</div>
						<div class="p-3 border-t border-gray-700 bg-gray-850">
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-mono text-gray-400 truncate grow" title={image.name}
									>{image.name}</span
								>
								<span class="text-xs text-gray-500 font-mono uppercase">PNG</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
