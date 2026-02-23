<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import Button from '../Button.svelte';
    import Slider from '../Slider.svelte';
    import MiniBar from '../MiniBar.svelte';
    import PlayIcon from '../icons/PlayIcon.svelte';
    import StopIcon from '../icons/StopIcon.svelte';
    import PauseIcon from '../icons/PauseIcon.svelte';
    import DownloadIcon from '../icons/DownloadIcon.svelte';
    import type { AudioDecoderState } from '../../audioDecoder.svelte';
    import * as m from '$lib/paraglide/messages';

    import {
        DATA_BLOCKS_PER_ROW, IMAGE_WIDTH, BLOCK_SIZE, CHANNEL_MODE,
        decodeRowSBR, SBR_SUBGROUPS_PER_ROW, PROCESSING_MODE_NAMES, PATCH_MODE_NAMES, TRANSIENT_SHAPE_NAMES,
        type SBRParams, type SBRParamsTemporal
    } from '../../constants';
    import type { AudioResult, BlockStats, VisualizationMetadata } from '@pixel-exchange-format/codec';

	const { decoderState, imagePreviewUrls, isSaving, onDownload }: {
		decoderState: AudioDecoderState;
		imagePreviewUrls: string[];
		isSaving: boolean;
		onDownload: () => void;
		onReset: () => void;
	} = $props<{
		decoderState: AudioDecoderState;
		imagePreviewUrls: string[];
		isSaving: boolean;
		onDownload: () => void;
		onReset: () => void;
	}>();
    
    // Visualizer Refs
    let requestRef = 0;
    // svelte-ignore non_reactive_update
    let imageContainer: HTMLDivElement;
    // svelte-ignore non_reactive_update
    let imageElement: HTMLImageElement;
    // svelte-ignore non_reactive_update
    let rowHighlight: HTMLDivElement;
    // svelte-ignore non_reactive_update
    let blockHighlight: HTMLDivElement;
    let prevScale = 0;

    // HUD State - Reactive values and bar widths
    let hudLumaVal = $state("0.0");
    let hudLumaBarWidth = $state(0);
    let hudChromaVal = $state("0.0");
    let hudChromaBarWidth = $state(0);
    
    let hudBand0Val = $state("0 dB");
    let hudBand0BarWidth = $state(0);
    let hudBand1Val = $state("0 dB");
    let hudBand1BarWidth = $state(0);
    let hudBand2Val = $state("0 dB");
    let hudBand2BarWidth = $state(0);
    let hudBand3Val = $state("0 dB");
    let hudBand3BarWidth = $state(0);

    // SBR HUD State
    let hudSbrMode = $state("Normal");  // Normal or Temporal
    let hudSbrGain = $state("0 dB");
    let hudSbrGainBarWidth = $state(0);
    let hudSbrNoise = $state("0");
    let hudSbrTonality = $state("0");
    let hudSbrPatch = $state("Adjacent");
    let hudSbrProc = $state("Normal");
    let hudSbrTransient = $state("Flat");
    let hudSbrEnvelope = $state("0, 0, 0, 0");

    // Playback State
    let currentTime = $state(0);
    let duration = $derived(decoderState.result && decoderState.result.type === 'audio' ? (decoderState.result as AudioResult).decoder.duration : 0);
    let isSeeking = $state(false);

    // Track last processed block to avoid redundant stats calculations
    let lastProcessedBlock = $state(-1);

    // Current source and image index based on playback position
    let currentSourceInfo = $derived(() => {
        if (!decoderState.result || decoderState.result.type !== 'audio') {
            return { sourceIndex: 0, imageIndex: 0, localBlockIndex: 0 };
        }

        const decoder = (decoderState.result as AudioResult).decoder;
        const sources = decoder.sources;
        const time = currentTime;
        const sampleRate = decoder.sampleRate;
        const hopSize = decoder.visualizationMetadata.hopSize;
        const currentSample = Math.floor(time * sampleRate);
        const globalBlockIndex = Math.floor(currentSample / hopSize);

        // Check if we have multi-part stereo
        const midSrcs = sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        if (midSrcs.length > 1) {
            // Multi-part stereo: calculate part and local block
            const blocksPerPart = Math.ceil(midSrcs[0].totalSamples / hopSize);
            const partIndex = Math.floor(globalBlockIndex / blocksPerPart);
            const localBlockInPart = globalBlockIndex % blocksPerPart;

            // Find the mid source for this part
            const midSrc = midSrcs.find(s => s.imageIndex === partIndex * 2 + 1);
            if (midSrc) {
                const sourceIndex = sources.indexOf(midSrc);
                const imageIndex = partIndex; // Each part has one image (mid channel)
                return {
                    sourceIndex,
                    imageIndex,
                    localBlockIndex: localBlockInPart
                };
            }
        } else {
            // Single file or mono multi-part: use sequential logic
            let remainingBlocks = globalBlockIndex;
            let imageIndex = 0;

            for (let i = 0; i < sources.length; i++) {
                const src = sources[i];
                const blocksInThisSource = Math.ceil(src.totalSamples / hopSize);

                if (remainingBlocks < blocksInThisSource) {
                    // This is the source containing our current position
                    return {
                        sourceIndex: i,
                        imageIndex: imageIndex,
                        localBlockIndex: remainingBlocks
                    };
                }

                remainingBlocks -= blocksInThisSource;
                // Only increment imageIndex if this source is shown (mid or mono channel)
                if (src.channelMode === 0 || src.channelMode === 1) { // MONO or STEREO_MID
                    imageIndex++;
                }
            }
        }

        // Fallback to last visible image
        return {
            sourceIndex: sources.length - 1,
            imageIndex: Math.max(0, sources.filter(s => s.channelMode === 0 || s.channelMode === 1).length - 1),
            localBlockIndex: 0
        };
    });

    function formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    
    async function handleSeek(e: Event) {
        const target = e.target as HTMLInputElement;
        const time = parseFloat(target.value);
        await decoderState.player.seek(time);
        currentTime = time;
    }

    function toDecibels(factor: number): string {
        const dB = 20 * Math.log10(factor);
        return (dB > 0 ? '+' + dB.toFixed(1) : dB.toFixed(1)) + ' dB'
    }

    // Helper: Determine audio channel status
    function getAudioChannelStatus(): string {
        if (!decoderState.result || decoderState.result.type !== 'audio') {
            return "Unknown";
        }

        const decoder = (decoderState.result as AudioResult).decoder;
        const sources = decoder.sources;
        
        const hasMono = sources.some(s => s.channelMode === CHANNEL_MODE.MONO);
        const hasMid = sources.some(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        const hasSide = sources.some(s => s.channelMode === CHANNEL_MODE.STEREO_SIDE);

        if (hasMid && hasSide) {
            return "Stereo";
        } else if (hasMono) {
            return "Mono (Original)";
        } else if (hasMid) {
            return "Mono (Side Missing)";
        } else {
            return "Mono";
        }
    }

    // Helper: Convert time to audio block index
    function timeToAudioBlockIndex(time: number, sampleRate: number, hopSize: number): number {
        const sampleIndex = time * sampleRate;
        return Math.floor(sampleIndex / hopSize);
    }

    // Helper: Convert audio block index to absolute image block coordinates
    function audioBlockToImageBlock(audioBlockIndex: number, metadata: VisualizationMetadata): { row: number, col: number } {
        const { firstAudioBlockIndex, blocksPerRow } = metadata;
        const rowIndex = Math.floor(audioBlockIndex / DATA_BLOCKS_PER_ROW);
        const colIndexInData = audioBlockIndex % DATA_BLOCKS_PER_ROW;
        const absoluteImageBlockIndex = firstAudioBlockIndex + (rowIndex * blocksPerRow) + colIndexInData;
        
        return {
            row: Math.floor(absoluteImageBlockIndex / blocksPerRow),
            col: absoluteImageBlockIndex % blocksPerRow
        };
    }

    // Helper: Convert image block to audio block index
    function imageBlockToAudioBlock(imageRow: number, imageCol: number): number | null {
        // Validate click is in audio area
        if (imageRow < 2 || imageCol < 0 || imageCol >= DATA_BLOCKS_PER_ROW) {
            return null;
        }
        
        const rowInAudioArea = imageRow - 2;
        return rowInAudioArea * DATA_BLOCKS_PER_ROW + imageCol;
    }

    // Helper: Convert audio block index to time
    function audioBlockToTime(audioBlockIndex: number, sampleRate: number, hopSize: number): number {
        const sampleIndex = audioBlockIndex * hopSize;
        return sampleIndex / sampleRate;
    }

    // Helper: Calculate viewport scale
    function calculateScale(viewportWidth: number): number {
        return viewportWidth / IMAGE_WIDTH;
    }

    // Helper: Calculate vertical translation for centering current row
    function calculateVerticalTranslation(
        currentRow: number,
        viewportHeight: number,
        scale: number
    ): number {
        const rowY = currentRow * BLOCK_SIZE;
        const rowHeight = BLOCK_SIZE;
        const viewCenterY_unscaled = (viewportHeight / 2) / scale;
        return viewCenterY_unscaled - (rowY + rowHeight / 2);
    }

    function updateVisualizer() {
        if (!decoderState.result || decoderState.result.type !== 'audio') return;
        
        const container = imageContainer;
        const img = imageElement;
        
        if (img && container) {
            const time = decoderState.player.getCurrentTime();
            
            if (!isSeeking) {
                currentTime = time; // Update reactive state only if not seeking
            }

            const { visualizationMetadata } = decoderState.result;
            const { sampleRate, hopSize } = visualizationMetadata;

            // Get current source info and use local block index within that source
            const sourceInfo = currentSourceInfo();
            const localBlockIndex = sourceInfo.localBlockIndex;
            
            // Calculate position within the current source image
            const { row, col } = audioBlockToImageBlock(localBlockIndex, visualizationMetadata);

            const viewportWidth = container.clientWidth;
            const viewportHeight = container.clientHeight;
            
            if (viewportWidth > 0 && viewportHeight > 0) {
                const scale = calculateScale(viewportWidth);
                const translateY_unscaled = calculateVerticalTranslation(row, viewportHeight, scale);
                
                img.style.transform = `scale(${scale}) translate(0px, ${translateY_unscaled}px)`;
                img.style.transformOrigin = '0 0';

                // Update highlights when scale changes
                if (Math.abs(scale - prevScale) > 0.001) {
                    const sizePx = `${BLOCK_SIZE * scale}px`;
                    const topPx = `calc(50% - ${(BLOCK_SIZE * scale)/2}px)`;

                    if (rowHighlight) {
                        rowHighlight.style.height = sizePx;
                        rowHighlight.style.top = topPx;
                    }

                    if (blockHighlight) {
                        blockHighlight.style.width = sizePx;
                        blockHighlight.style.height = sizePx;
                        blockHighlight.style.top = topPx;
                    }
                    prevScale = scale;
                }

                // Position block highlight
                if (blockHighlight) {
                    const blockX = col * BLOCK_SIZE;
                    blockHighlight.style.left = `${blockX * scale}px`;
                }
            }

            // Update stats using global block index
            const globalBlockIndex = timeToAudioBlockIndex(time, sampleRate, hopSize);
            if (globalBlockIndex !== lastProcessedBlock) {
                lastProcessedBlock = globalBlockIndex;
                const stats: BlockStats | null = decoderState.result.decoder.getStatsAtBlock(globalBlockIndex);
                if (stats) {
                    updateHUD(stats, globalBlockIndex);
                }
            }
        }

        requestRef = requestAnimationFrame(updateVisualizer);
    }

    function updateHUD(stats: BlockStats, currentAudioBlockIndex: number) {
        hudLumaVal = stats.lumaScale.toFixed(4);
        hudLumaBarWidth = Math.min(100, (stats.lumaScale / 2.0) * 100);
        
        hudChromaVal = stats.chromaScale.toFixed(4);
        hudChromaBarWidth = Math.min(100, (stats.chromaScale / 2.0) * 100);
        
        const bands = stats.bandFactors;
        
        hudBand0Val = toDecibels(bands[0])
        hudBand0BarWidth = 100.0 * bands[0] / 2;

        hudBand1Val = toDecibels(bands[1]);
        hudBand1BarWidth = 100.0 * bands[1] / 2;
        
        hudBand2Val = toDecibels(bands[2]);
        hudBand2BarWidth = 100.0 * bands[2] / 2;
        
        hudBand3Val = toDecibels(bands[3]);
        hudBand3BarWidth = 100.0 * bands[3] / 2;

        // Decode SBR parameters
        if (stats.sbrData && stats.sbrData.length === 8) {
            const rowSBRParams = decodeRowSBR(stats.sbrData);
            
            // Determine which SBR subgroup this block belongs to (2 subgroups)
            const colInAudioArea = currentAudioBlockIndex % DATA_BLOCKS_PER_ROW;
            const blocksPerSubgroup = Math.floor(DATA_BLOCKS_PER_ROW / SBR_SUBGROUPS_PER_ROW);
            const sbrSubgroupIndex = Math.min(SBR_SUBGROUPS_PER_ROW - 1, Math.floor(colInAudioArea / blocksPerSubgroup));
            const sbrParams = rowSBRParams.subgroups[sbrSubgroupIndex];
            
            // Check if temporal mode
            if (sbrParams.temporalMode) {
                const temporal = sbrParams as SBRParamsTemporal;
                const blockInSubgroup = colInAudioArea - (sbrSubgroupIndex * blocksPerSubgroup);
                const isSecondHalf = blockInSubgroup >= Math.floor(blocksPerSubgroup / 2);
                
                hudSbrMode = `Temporal (${isSecondHalf ? 'B' : 'A'})`;
                const gain = isSecondHalf ? temporal.hfGainB : temporal.hfGainA;
                hudSbrGain = `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`;
                hudSbrGainBarWidth = Math.min(100, Math.max(0, (gain + 48) / 63 * 100));
                hudSbrNoise = `${isSecondHalf ? temporal.noiseFloorRatioB : temporal.noiseFloorRatioA}/3`;
                hudSbrTonality = `${temporal.tonality}/3`;
                hudSbrPatch = PATCH_MODE_NAMES[temporal.patchMode] || 'Adjacent';
                hudSbrProc = PROCESSING_MODE_NAMES[temporal.procMode] || 'Normal';
                hudSbrTransient = (isSecondHalf ? temporal.transientB : temporal.transientA) ? 'Attack' : 'Flat';
                hudSbrEnvelope = temporal.bandEnvelope.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join(', ');
            } else {
                const normal = sbrParams as SBRParams;
                hudSbrMode = 'Normal';
                hudSbrGain = `${normal.hfGain >= 0 ? '+' : ''}${normal.hfGain.toFixed(1)} dB`;
                hudSbrGainBarWidth = Math.min(100, Math.max(0, (normal.hfGain + 48) / 63 * 100));
                hudSbrNoise = `${normal.noiseFloorRatio}/15`;
                hudSbrTonality = `${normal.tonality}/7`;
                hudSbrPatch = PATCH_MODE_NAMES[normal.patchMode] || 'Adjacent';
                hudSbrProc = PROCESSING_MODE_NAMES[normal.procMode] || 'Normal';
                hudSbrTransient = TRANSIENT_SHAPE_NAMES[normal.transientShape] || 'Flat';
                hudSbrEnvelope = normal.bandEnvelope.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join(', ');
            }
        }
    }

    async function handleImageClick(event: MouseEvent) {
        if (!decoderState.result || decoderState.result.type !== 'audio') return;

        const container = imageContainer;
        const img = imageElement;
        if (!img || !container) return;

        const decoder = (decoderState.result as AudioResult).decoder;
        const sources = decoder.sources;
        const { visualizationMetadata } = decoderState.result;
        const { sampleRate, hopSize } = visualizationMetadata;

        // Get click position and current transform state
        const rect = container.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        const scale = calculateScale(container.clientWidth);

        // Convert click to unscaled image coordinates
        const clickX_unscaled = clickX / scale;
        const clickY_unscaled = clickY / scale;

        // Get current source info and local block index for vertical translation
        const sourceInfo = currentSourceInfo();
        const localBlockIndex = sourceInfo.localBlockIndex;
        const currentBlock = audioBlockToImageBlock(localBlockIndex, visualizationMetadata);

        // Calculate vertical translation and reverse it
        const translateY_unscaled = calculateVerticalTranslation(
            currentBlock.row,
            container.clientHeight,
            scale
        );
        const imageY = clickY_unscaled - translateY_unscaled;

        // Convert to block coordinates within the current source
        const clickedRow = Math.floor(imageY / BLOCK_SIZE);
        const clickedCol = Math.floor(clickX_unscaled / BLOCK_SIZE);

        // Convert image block to local audio block index within current source (validates bounds)
        const clickedLocalBlockIndex = imageBlockToAudioBlock(clickedRow, clickedCol);
        if (clickedLocalBlockIndex === null) return; // Outside audio area

        // Convert local block index to global block index
        let globalBlockIndex = 0;

        // Check if we have multi-part stereo
        const midSrcs = sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        if (midSrcs.length > 1) {
            // Multi-part stereo: calculate global block from part and local block
            const partIndex = sourceInfo.imageIndex;
            const blocksPerPart = Math.ceil(midSrcs[0].totalSamples / hopSize);
            globalBlockIndex = partIndex * blocksPerPart + clickedLocalBlockIndex;
        } else {
            // Single file or mono multi-part: use sequential logic
            for (let i = 0; i < sourceInfo.sourceIndex; i++) {
                const src = sources[i];
                globalBlockIndex += Math.ceil(src.totalSamples / hopSize);
            }
            globalBlockIndex += clickedLocalBlockIndex;
        }

        // Convert to time and seek
        const clickedTime = audioBlockToTime(globalBlockIndex, sampleRate, hopSize);
        const maxTime = decoder.duration;
        const seekTime = Math.max(0, Math.min(clickedTime, maxTime));

        await decoderState.player.seek(seekTime);
    }

    $effect(() => {
        prevScale = 0;
        lastProcessedBlock = -1; // Reset when effect re-runs

        if (decoderState.result && decoderState.result.type == "audio" && imagePreviewUrls.length > 0) {
            requestRef = requestAnimationFrame(updateVisualizer);
            return () => cancelAnimationFrame(requestRef);
        } else {
            return () => {};
        }
    });
</script>

<div class="flex flex-col w-full h-full bg-gray-950">
	<!-- TOP PANEL: HUD -->
	<div class="flex-none bg-gray-900 border-b border-gray-800 p-2 text-xs">
		<div class="flex items-stretch text-xs h-24">
			<!-- SECTION 1: Dynamic Range -->
			<div class="flex-[0.5] px-4 flex flex-col justify-center min-w-50">
				<div class="text-gray-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
					{m.stat_dynamic_range()}
				</div>
				<div class="grid grid-cols-1 gap-1">
					<MiniBar
						label={m.stat_luma_max()}
						percent={hudLumaBarWidth}
						value={hudLumaVal}
						colorClass="bg-teal-500"
						valueClass="text-teal-400"
					/>
					<MiniBar
						label={m.stat_chroma_max()}
						percent={hudChromaBarWidth}
						value={hudChromaVal}
						colorClass="bg-purple-500"
						valueClass="text-purple-400"
					/>
				</div>
			</div>

			<!-- DIVIDER -->
			<div class="w-px border-r border-gray-700"></div>

			<!-- SECTION 2: Band Boost -->
			<div class="flex-[0.75] px-4 flex flex-col justify-center min-w-60">
				<div class="text-gray-400 uppercase font-bold tracking-wider mb-2">
					{m.stat_band_boost()}
				</div>
				<div class="grid grid-cols-2 gap-x-6 gap-y-1">
					<MiniBar
						label={m.stat_band_low()}
						percent={hudBand0BarWidth}
						value={hudBand0Val}
						colorClass="bg-blue-500"
						valueClass="text-blue-400"
					/>
					<MiniBar
						label={m.stat_band_lo_mid()}
						percent={hudBand1BarWidth}
						value={hudBand1Val}
						colorClass="bg-green-500"
						valueClass="text-green-400"
					/>
					<MiniBar
						label={m.stat_band_hi_mid()}
						percent={hudBand2BarWidth}
						value={hudBand2Val}
						colorClass="bg-orange-500"
						valueClass="text-orange-400"
					/>
					<MiniBar
						label={m.stat_band_high()}
						percent={hudBand3BarWidth}
						value={hudBand3Val}
						colorClass="bg-pink-500"
						valueClass="text-pink-400"
					/>
				</div>
			</div>

			<!-- DIVIDER -->
			<div class="w-px border-r border-gray-700"></div>

			<!-- SECTION 3: SBR Parameters -->
			<div class="flex-1 px-4 flex flex-col justify-center min-w-70">
				<div class="text-gray-400 font-bold tracking-wider mb-2">
					<span class="uppercase">{m.stat_sbr()}</span>
				</div>
				<div class="grid grid-cols-3 gap-x-4 gap-y-1">
					<!-- Row 1: Gain bar spanning all cols -->
					<div class="col-span-1 mb-1">
						<MiniBar
							label={m.stat_gain()}
							percent={hudSbrGainBarWidth}
							value={hudSbrGain}
							colorClass="bg-cyan-500"
							valueClass="text-cyan-400"
						/>
					</div>

					<!-- Row 2: Envelope spanning all cols -->
					<div
						class="col-span-2 flex justify-between items-center border-b border-gray-800/50 pb-0.5"
					>
						<span class="text-gray-400 text-xs">Envelope</span>
						<span class="text-amber-400 text-xs font-mono">{hudSbrEnvelope}</span>
					</div>

					<!-- Row 3: Noise, Tonality, Transient -->
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Mode</span>
						<span class="text-sky-400 text-xs">{hudSbrMode}</span>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Noise</span>
						<span class="text-sky-400 text-xs">{hudSbrNoise}</span>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Tonal</span>
						<span class="text-rose-400 text-xs">{hudSbrTonality}</span>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Trans</span>
						<span class="text-lime-400 text-xs">{hudSbrTransient}</span>
					</div>

					<!-- Row 4: Patch, Proc -->
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Patch</span>
						<span class="text-violet-400 text-xs">{hudSbrPatch}</span>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-gray-400 text-xs">Proc</span>
						<span class="text-orange-400 text-xs">{hudSbrProc}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Info Bar -->
	{#if decoderState.result && decoderState.result.type === 'audio'}
		<div
			class="flex-none bg-gray-950 border-b border-gray-800 px-4 py-2 grid grid-cols-1 gap-1 text-xs"
		>
			<div class="flex items-center justify-between">
				<div
					class="font-mono text-gray-400 font-bold truncate max-w-md"
					title={decoderState.result.metadata.fn || 'Unknown'}
				>
					{decoderState.result.metadata.fn || 'Unknown'}
				</div>
				<div
					class="flex items-center gap-4 text-xs text-gray-400 font-mono uppercase tracking-wider"
				>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{formatTime(decoderState.result.decoder.duration)}
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{Math.round(decoderState.result.visualizationMetadata.sampleRate / 1000)}kHz
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{getAudioChannelStatus()}
					</div>
				</div>
			</div>
			<div class="flex items-baseline flex-wrap gap-2 text-xs">
				{#each Object.entries(decoderState.result.metadata) as [key, value]}
					{#if key !== 'fn'}<!-- filename is already shown above -->
						<span class="text-gray-400 leading-none">
							<span class="font-medium">{key}:</span> <span class="text-gray-300">{value}</span>
						</span>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<!-- MIDDLE AREA: Visualizer -->
	<div
		bind:this={imageContainer}
		onclick={handleImageClick}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && handleImageClick(e as unknown as MouseEvent)}
		class="grow relative bg-black overflow-hidden cursor-crosshair w-full h-full shadow-inner"
	>
		{#if imagePreviewUrls.length > 0}
			<img
				bind:this={imageElement}
				src={imagePreviewUrls[currentSourceInfo().imageIndex] || imagePreviewUrls[0]}
				alt="Visualizer"
				class="absolute left-0 top-0 rendering-pixelated will-change-transform opacity-90"
				style="image-rendering: pixelated; width: 1024px; max-width: none;"
			/>
		{/if}
		<!-- Highlights -->
		<div
			bind:this={rowHighlight}
			class="absolute left-0 w-full bg-white/5 border-y border-white/20 pointer-events-none z-10 box-border"
		></div>
		<div
			bind:this={blockHighlight}
			class="absolute bg-primary-400/30 border border-primary-200 shadow-[0_0_15px_rgba(59,130,246,0.6)] pointer-events-none z-20 box-border"
		></div>
	</div>

	<!-- BOTTOM PANEL: Transport Bar -->
	<div class="flex-none bg-gray-900 border-t border-gray-800 p-4 z-40">
		<div class="max-w-4xl mx-auto w-full flex flex-col gap-4">
			<!-- Seek Bar -->
			<!-- Seek Bar -->
			<div class="w-full h-8 flex flex-col justify-end group relative">
				<!-- Time Markers -->
				<div
					class="flex justify-between text-xs font-mono font-bold text-gray-500 uppercase tracking-wider mb-1"
				>
					<span>{formatTime(currentTime)}</span>
					<span>{formatTime(duration)}</span>
				</div>

				<Slider
					min={0}
					max={duration}
					step={0.01}
					bind:value={currentTime}
					oninput={handleSeek}
					onpointerdown={() => (isSeeking = true)}
					onpointerup={() => (isSeeking = false)}
					onpointercancel={() => (isSeeking = false)}
					label="Seek"
				/>
			</div>

			<div class="flex items-center justify-between">
				<!-- Controls -->
				<div class="flex items-center gap-3">
					<Button
						variant="secondary"
						onclick={() => decoderState.player.stop()}
						title="Stop"
						class="px-3 py-2 bg-gray-800 border-gray-700"
					>
						<StopIcon class="w-5 h-5" />
					</Button>
					<Button
						primary={true}
						onclick={async () =>
							decoderState.player.isPlaying
								? decoderState.player.pause()
								: await decoderState.playDecodedAudio()}
						title={decoderState.player.isPlaying ? 'Pause' : 'Play'}
						class="px-6 py-2 shadow-lg shadow-primary-900/20"
					>
						{#if decoderState.player.isPlaying}
							<PauseIcon class="w-5 h-5" />
						{:else}
							<PlayIcon class="w-5 h-5 ml-0.5" />
						{/if}
					</Button>
				</div>

				<!-- Right: Volume & Actions -->
				<div class="flex items-center gap-6">
					<!-- Volume -->
					<div
						class="flex items-center gap-3 bg-gray-950/50 px-3 py-1.5 rounded-full border border-gray-800"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="w-4 h-4 text-gray-500"
						>
							<path
								fill-rule="evenodd"
								d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z"
								clip-rule="evenodd"
							/>
						</svg>
						<Slider
							min={0}
							max={1}
							step={0.01}
							value={decoderState.player.volume}
							oninput={(e: Event) =>
								decoderState.player.setVolume(parseFloat((e.target as HTMLInputElement).value))}
							class="w-32 min-w-25"
							label="Volume"
						/>
					</div>

					<div class="h-6 w-px bg-gray-800"></div>

					<div class="flex gap-2">
						<Button
							onclick={onDownload}
							disabled={isSaving}
							class="text-xs px-3 py-1.5"
							variant="secondary"
						>
							<DownloadIcon class="w-4 h-4 mr-2" />
							{isSaving ? m.btn_saving() : m.btn_save_wav()}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
