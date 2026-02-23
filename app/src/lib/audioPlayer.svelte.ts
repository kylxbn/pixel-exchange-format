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
        window.clearTimeout(this.schedulerTimer);
        if (this.audioContext) {
            this.audioContext.suspend();
        }
        this.isPlaying = false;
        this.pausedAt = 0;
    }

    pause(): void {
        if (this.isPlaying && this.audioContext) {
            window.clearTimeout(this.schedulerTimer);
            this.audioContext.suspend();

            const elapsedSession = this.audioContext.currentTime - this.startTime;

            const currentPos = this.pausedAt + elapsedSession;
            this.pausedAt = Math.min(currentPos, this.decoder?.duration || 0);

            this.isPlaying = false;
        }
    }

    getCurrentTime(): number {
        if (!this.audioContext) return this.pausedAt;
        if (this.isPlaying) {
            return Math.min((this.audioContext.currentTime - this.startTime) + this.pausedAt, this.decoder?.duration || 0);
        }
        return this.pausedAt;
    }

    async seek(timeSeconds: number): Promise<void> {
        if (!this.decoder) return;

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
        if (this.isPlaying) return;
        if (typeof window === 'undefined') return;

        this.decoder = decoder;
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioContext = new AudioContextClass({ sampleRate: decoder.sampleRate });
        this.audioContext = audioContext;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = this.volume;
        gainNode.connect(audioContext.destination);
        this.gainNode = gainNode;

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

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
                    this.isPlaying = false;
                    this.pausedAt = 0;
                    return;
                }

                const buffer = audioContext.createBuffer(chunkChannels.length, len, decoder.sampleRate);
                for (let i = 0; i < chunkChannels.length; i++) {
                    const channelData = new Float32Array(chunkChannels[i]);
                    buffer.copyToChannel(channelData, i);
                }

                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(gainNode);
                source.start(this.nextStartTime);

                this.nextStartTime += buffer.duration;
            }
            this.schedulerTimer = window.setTimeout(scheduler, this.LOOKAHEAD_MS);
        };

        scheduler();
        this.isPlaying = true;
    }

    cleanup(): void {
        if (typeof window === 'undefined') return;
        window.clearTimeout(this.schedulerTimer);
        if (this.audioContext) this.audioContext.close();
    }
}
