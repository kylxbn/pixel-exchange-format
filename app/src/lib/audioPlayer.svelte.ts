// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { type StreamingAudioDecoder } from '@pixel-exchange-format/codec';

export class AudioPlayer {
	isPlaying = $state(false);
	volume = $state(0.5);

	private audioContext: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private nextStartTime = 0;
	private schedulerTimer = 0;
	private decoder: StreamingAudioDecoder | null = null;
	private scheduledSources: AudioBufferSourceNode[] = [];
	private starting = false;

	private pausedAt = 0;
	private startTime = 0;

	private SCHEDULE_AHEAD_TIME = 0.2;
	private LOOKAHEAD_MS = 50;

	setVolume(val: number): void {
		const clamped = Math.max(0, Math.min(1, val));
		this.volume = clamped;

		if (this.gainNode && this.audioContext) {
			const ctx = this.audioContext;
			const gain = this.gainNode.gain;
			const now = ctx.currentTime;

			gain.cancelScheduledValues(now);
			gain.setValueAtTime(gain.value, now);
			gain.linearRampToValueAtTime(clamped, now + 0.05);
		}
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		this.stopScheduling();
		if (this.audioContext && this.audioContext.state === 'running') {
			void this.audioContext.suspend();
		}
		this.isPlaying = false;
		this.pausedAt = 0;
	}

	pause(): void {
		if (!this.isPlaying || !this.audioContext) return;

		const elapsedSession = this.audioContext.currentTime - this.startTime;
		this.pausedAt = Math.min(this.pausedAt + elapsedSession, this.decoder?.duration || 0);

		this.stopScheduling();
		void this.audioContext.suspend();
		this.isPlaying = false;
	}

	getCurrentTime(): number {
		if (!this.audioContext) return this.pausedAt;
		if (this.isPlaying) {
			return Math.min(
				this.audioContext.currentTime - this.startTime + this.pausedAt,
				this.decoder?.duration || 0
			);
		}
		return this.pausedAt;
	}

	async seek(timeSeconds: number): Promise<void> {
		if (!this.decoder) return;
		if (!Number.isFinite(timeSeconds)) return;

		const clampedTime = Math.max(0, Math.min(timeSeconds, this.decoder.duration));

		const wasPlaying = this.isPlaying;

		if (this.isPlaying) {
			this.pause();
		}

		this.pausedAt = clampedTime;

		if (wasPlaying) {
			await this.play(this.decoder);
		}
	}

	async play(decoder: StreamingAudioDecoder): Promise<void> {
		if (this.isPlaying || this.starting) return;
		if (typeof window === 'undefined') return;

		this.starting = true;
		this.stopScheduling();

		try {
			this.decoder = decoder;
			const { audioContext, gainNode } = this.ensureContext(decoder.sampleRate);

			if (audioContext.state === 'suspended') {
				await audioContext.resume();
			}
			if (!this.starting) return;

			const startOffset = this.pausedAt;
			if (startOffset >= decoder.duration) {
				this.pausedAt = 0;
				decoder.seek(0);
			} else {
				decoder.seek(Math.floor(startOffset * decoder.sampleRate));
			}

			this.startTime = audioContext.currentTime;
			this.nextStartTime = audioContext.currentTime;

			const scheduler = () => {
				while (this.nextStartTime < audioContext.currentTime + this.SCHEDULE_AHEAD_TIME) {
					const chunkChannels = decoder.decodeChunk(0.1);
					const len = chunkChannels[0].length;
					if (len === 0) {
						const remainingMs = Math.max(0, (this.nextStartTime - audioContext.currentTime) * 1000);
						this.schedulerTimer = window.setTimeout(() => this.handleEnded(), remainingMs);
						return;
					}

					const buffer = audioContext.createBuffer(chunkChannels.length, len, decoder.sampleRate);
					for (let i = 0; i < chunkChannels.length; i++) {
						buffer.copyToChannel(new Float32Array(chunkChannels[i]), i);
					}

					const source = audioContext.createBufferSource();
					source.buffer = buffer;
					source.connect(gainNode);
					source.onended = () => {
						source.disconnect();
						const idx = this.scheduledSources.indexOf(source);
						if (idx !== -1) this.scheduledSources.splice(idx, 1);
					};
					source.start(this.nextStartTime);
					this.scheduledSources.push(source);

					this.nextStartTime += buffer.duration;
				}
				this.schedulerTimer = window.setTimeout(scheduler, this.LOOKAHEAD_MS);
			};

			this.isPlaying = true;
			scheduler();
		} finally {
			this.starting = false;
		}
	}

	cleanup(): void {
		if (typeof window === 'undefined') return;
		this.stopScheduling();
		this.starting = false;
		this.isPlaying = false;
		this.pausedAt = 0;
		this.decoder = null;
		if (this.gainNode) {
			this.gainNode.disconnect();
			this.gainNode = null;
		}
		if (this.audioContext) {
			if (this.audioContext.state !== 'closed') void this.audioContext.close();
			this.audioContext = null;
		}
	}

	private ensureContext(sampleRate: number): { audioContext: AudioContext; gainNode: GainNode } {
		if (
			this.audioContext &&
			this.gainNode &&
			this.audioContext.state !== 'closed' &&
			this.audioContext.sampleRate === sampleRate
		) {
			return { audioContext: this.audioContext, gainNode: this.gainNode };
		}

		if (this.gainNode) this.gainNode.disconnect();
		if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close();

		const AudioContextClass =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		const audioContext = new AudioContextClass({ sampleRate });
		this.audioContext = audioContext;

		const gainNode = audioContext.createGain();
		gainNode.gain.value = this.volume;
		gainNode.connect(audioContext.destination);
		this.gainNode = gainNode;

		return { audioContext, gainNode };
	}

	private stopScheduling(): void {
		window.clearTimeout(this.schedulerTimer);
		this.schedulerTimer = 0;
		for (const source of this.scheduledSources) {
			source.onended = null;
			try {
				source.stop();
			} catch {
				// already stopped
			}
			source.disconnect();
		}
		this.scheduledSources = [];
	}

	private handleEnded(): void {
		this.stopScheduling();
		this.isPlaying = false;
		this.pausedAt = 0;
	}
}
