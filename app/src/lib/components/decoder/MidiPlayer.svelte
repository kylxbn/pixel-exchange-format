<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
    import spessasynthProcessorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
    import PlayIcon from '../icons/PlayIcon.svelte';
    import PauseIcon from '../icons/PauseIcon.svelte';
    import StopIcon from '../icons/StopIcon.svelte';
    import DownloadIcon from '../icons/DownloadIcon.svelte';
    import Button from '../Button.svelte';
    import Slider from '../Slider.svelte';
    import { extractMidiInfo, type MidiInfo } from '../../midiLoader';
    import * as m from '$lib/paraglide/messages';

    let { 
        data, 
        filename,
        comment,
        onClose, 
        validChecksum 
    }: { 
        data: ArrayBuffer | Uint8Array; 
        filename: string; 
        comment: string; 
        onClose: () => void; 
        validChecksum: boolean; 
    } = $props();

    let isPlaying = $state(false);
    let duration = $state(0);
    let tempo = $state(0);
    let playbackRate = $state(0);
    let currentTime = $state(0);
    let isLoaded = $state(false);
    let loadError = $state<string | null>(null);
    let volume = $state(1);

    let midiInfo = $state<MidiInfo | null>(null);

    let synth: WorkletSynthesizer | undefined;
    let sequencer: Sequencer | undefined;
    let audioContext: AudioContext;
    let gainNode: GainNode | undefined;
    let analyser: AnalyserNode | undefined;
    // svelte-ignore non_reactive_update
    let canvas: HTMLCanvasElement;
    let animationId: number;

    // svelte-ignore non_reactive_update
    let progressBar: HTMLInputElement;
    let updateInterval: number;

    function formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function animateVisualizer() {
        if (!canvas || !analyser) return;

        animationId = requestAnimationFrame(animateVisualizer);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Auto-resize canvas to match display size
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }

        const width = canvas.width;
        const height = canvas.height;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, width, height);

        // Styling
        const barWidth = width / bufferLength;
        let barHeight;
        let x = 0;

        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.9)'); // primary-500
        gradient.addColorStop(1, 'rgba(147, 197, 253, 0.5)'); // blue-300 transparent

        ctx.fillStyle = gradient;

        for (let i = 0; i < bufferLength; i++) {
            // Scale bar height to fit nicely
            barHeight = (dataArray[i] / 255) * height;
            
            // Draw rects
            ctx.fillRect(x, height - barHeight, barWidth + 1, barHeight); // +1 to overlap slightly and avoid gaps
            x += barWidth;
        }
    }

    onMount(async () => {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            // Add AudioWorklet module
            await audioContext.audioWorklet.addModule(spessasynthProcessorUrl);

            // Create gain node for volume control
            gainNode = audioContext.createGain();
            gainNode.gain.value = volume;
            gainNode.connect(audioContext.destination);

            // Create Analyser
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.75;
            analyser.connect(gainNode);

            // Initialize Synthesizer
            synth = new WorkletSynthesizer(audioContext);
            synth.connect(analyser); // Synth -> Analyser -> Gain -> Destination

            // Load SoundFont
            const sfResponse = await fetch('/GeneralUser-GS.sf2');
            if (!sfResponse.ok) throw new Error(`Failed to load SoundFont: ${sfResponse.statusText}`);
            const sfArrayBuffer = await sfResponse.arrayBuffer();

            await synth.soundBankManager.addSoundBank(sfArrayBuffer, "main");

            // Initialize Sequencer
            sequencer = new Sequencer(synth);

            // Load MIDI Data
            let midiBuffer: ArrayBuffer;
            if (data instanceof ArrayBuffer) {
                midiBuffer = data;
            } else {
                midiBuffer = new Uint8Array(data).buffer.slice(0, data.byteLength);
            }

            midiInfo = extractMidiInfo(midiBuffer);

            sequencer.skipToFirstNoteOn = true;
            sequencer.loadNewSongList([{ binary: midiBuffer, fileName: filename }]);
            
            if (sequencer.duration) {
                duration = sequencer.duration;
            }
            if (sequencer.currentTempo) {
                tempo = sequencer.currentTempo;
            }

            isLoaded = true;
            await tick(); // Wait for DOM to update and canvas to be bound
            updateInterval = window.setInterval(updateUI, 100);
            
            // Start Visualizer
            animateVisualizer();

        } catch (e: any) {
            console.error("MIDI Init Failed:", e);
            loadError = e.message || "Failed to initialize MIDI player";
        }
    });

    onDestroy(() => {
        if (updateInterval) clearInterval(updateInterval);
        if (animationId) cancelAnimationFrame(animationId);
        if (sequencer) {
            sequencer.pause(); 
            if (synth) synth.destroy();
        }
        if (gainNode) {
            gainNode.disconnect();
        }
        if (analyser) {
            analyser.disconnect();
        }
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
    });

    function togglePlay() {
        if (!sequencer || !isLoaded) return;
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if (sequencer.paused) {
            sequencer.play();
            isPlaying = true;
        } else {
            sequencer.pause();
            isPlaying = false;
        }
    }

    function stop() {
        if (!sequencer) return;
        sequencer.currentTime = 0;
        sequencer.pause();
        isPlaying = false;
        currentTime = 0;
    }

    let isSeeking = false;

    function handleSeek(e: Event) {
        if (!sequencer) return;
        const target = e.target as HTMLInputElement;
        const time = parseFloat(target.value);
        sequencer.currentTime = time;
        currentTime = time;
    }

    function updateUI() {
        if (sequencer) {
            if (!isSeeking) {
                currentTime = sequencer.currentTime;
            }
            duration = sequencer.duration || 0;
            isPlaying = !sequencer.paused;
            tempo = sequencer.currentTempo;
            playbackRate = sequencer.playbackRate;
        }
    }

    function handleVolumeChange(e: Event) {
        if (!gainNode) return;
        const target = e.target as HTMLInputElement;
        const newVolume = parseFloat(target.value);
        volume = newVolume;
        gainNode.gain.value = newVolume;
    }

    function handleDownload() {
        const downloadData = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
        const blob = new Blob([downloadData], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
</script>

<div class="flex flex-col w-full h-full bg-gray-950 animate-in fade-in duration-300">
	<!-- Header / HUD -->
	<div
		class="flex-none bg-gray-900 border-b border-gray-800 p-4 shadow-sm flex justify-between items-center z-10"
	>
		<h2 class="text-sm font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
			<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
			{m.midi_player_title()}
		</h2>

		<!-- Integrity Badge -->
		<div
			class={`flex items-center gap-2 px-3 py-1 rounded text-xs font-bold border ${validChecksum ? 'bg-green-900/10 border-green-500/20 text-green-400' : 'bg-red-900/10 border-red-500/20 text-red-400'}`}
		>
			<span class={`w-2 h-2 rounded-full ${validChecksum ? 'bg-green-500' : 'bg-red-500'}`}></span>
			{validChecksum ? m.value_integrity_pass() : m.value_integrity_fail()}
		</div>
	</div>

	<!-- Info Bar -->
	<div
		class="flex-none bg-gray-950 border-b border-gray-800 px-4 py-2 grid grid-cols-1 gap-1 text-xs"
	>
		<div class="flex items-center justify-between">
			<div class="font-mono text-gray-400 font-bold truncate max-w-md" title={filename}>
				{filename}
			</div>
			<div class="flex items-center gap-4 text-xs text-gray-400 font-mono uppercase tracking-wider">
				{#if midiInfo}
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{m.label_midi_type()}
						{midiInfo.fileType}
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{midiInfo.standard}
					</div>
					<div class="flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
						{midiInfo.channelsUsed}
						{m.label_ch()}
					</div>
				{/if}
				<div class="flex items-center gap-1.5">
					<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
					{formatTime(duration)}
				</div>
				<div class="flex items-center gap-1.5">
					<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
					{Math.round(tempo)}
					{m.label_bpm()}
				</div>
			</div>
		</div>
		{#if comment}
			<div class="text-xs text-gray-400 truncate">
				{comment}
			</div>
		{:else}
			<div class="text-xs text-gray-500">{m.val_no_comment()}</div>
		{/if}
	</div>

	<!-- MAIN CONTENT CENTER -->
	<div class="grow flex flex-col items-center justify-center relative overflow-hidden">
		<!-- Background Grid/Decoration -->
		<div
			class="absolute inset-0 opacity-5"
			style="background-image: linear-gradient(0deg, transparent 24%, #ffffff 25%, #ffffff 26%, transparent 27%, transparent 74%, #ffffff 75%, #ffffff 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, #ffffff 25%, #ffffff 26%, transparent 27%, transparent 74%, #ffffff 75%, #ffffff 76%, transparent 77%, transparent); background-size: 50px 50px;"
		></div>

		{#if loadError}
			<div
				class="p-8 bg-red-900/20 border border-red-500/50 text-red-300 rounded-lg text-sm max-w-md w-full shadow-2xl z-10"
			>
				<p class="font-bold flex items-center gap-2 text-lg mb-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="w-6 h-6"
					>
						<path
							fill-rule="evenodd"
							d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
							clip-rule="evenodd"
						/>
					</svg>
					{m.midi_error_title()}
				</p>
				<p class="opacity-80 pl-8">{loadError}</p>
			</div>
		{:else if !isLoaded}
			<div class="flex flex-col items-center justify-center text-gray-500 z-10">
				<div
					class="w-16 h-16 border-4 border-gray-800 border-t-primary-500 rounded-full animate-spin mb-6"
				></div>
				<p class="font-mono text-sm uppercase tracking-widest animate-pulse">{m.midi_loading()}</p>
			</div>
		{:else}
			<!-- Visualizer -->
			<div class="absolute inset-0 z-10 w-full h-full">
				<!-- svelte-ignore non_reactive_update -->
				<canvas bind:this={canvas} class="w-full h-full block"></canvas>
				{#if !isPlaying}
					<div
						class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20"
					>
						<div class="text-6xl font-mono font-bold tracking-tighter text-gray-800/50 select-none">
							{m.overlay_midi()}
						</div>
						<div class="text-gray-500/50 font-mono text-sm uppercase tracking-[0.2em]">
							{m.overlay_ready()}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- BOTTOM CONTROLS STICKY -->
	<div class="flex-none bg-gray-900 border-t border-gray-800 p-4 z-20">
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
					step={0.1}
					bind:value={currentTime}
					oninput={handleSeek}
					onpointerdown={() => (isSeeking = true)}
					onpointerup={() => (isSeeking = false)}
					onpointercancel={() => (isSeeking = false)}
					label={m.aria_label_seek()}
				/>
			</div>

			<!-- Controls Row -->
			<div class="flex items-center justify-between">
				<!-- Left: Transport -->
				<div class="flex items-center gap-3">
					<Button
						variant="secondary"
						onclick={stop}
						title={m.btn_stop()}
						class="px-3 py-2 bg-gray-800 border-gray-700"
					>
						<StopIcon class="w-5 h-5" />
					</Button>
					<Button
						primary={true}
						onclick={togglePlay}
						title={isPlaying ? m.btn_pause() : m.btn_play()}
						class="px-6 py-2 shadow-lg shadow-primary-900/20"
					>
						{#if isPlaying}
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
							bind:value={volume}
							oninput={handleVolumeChange}
							class="w-32 min-w-25"
							label={m.midi_volume()}
						/>
					</div>

					<div class="h-6 w-px bg-gray-800"></div>

					<div class="flex gap-2">
						<Button
							variant="secondary"
							onclick={handleDownload}
							class="text-xs px-3 py-1.5"
							disabled={!isLoaded}
						>
							<DownloadIcon class="w-4 h-4 mr-2" />
							{m.btn_save_midi()}
						</Button>
						<Button variant="danger" onclick={onClose} class="text-xs px-3 py-1.5"
							>{m.btn_close()}</Button
						>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
