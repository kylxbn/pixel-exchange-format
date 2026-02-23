// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { PxfEncoder, type EncodedImageResult } from '@pixel-exchange-format/codec';
import { getWavMetadata } from './constants';

export interface WebEncodedImageResult extends EncodedImageResult {
    blob: Blob;
}

export class AudioEncoderState {
    isProcessing = $state(false);
    progress = $state(0);
    images = $state<WebEncodedImageResult[]>([]);
    error = $state<string | null>(null);

    async processAudio(
        file: File,
        metadata: Record<string, string>,
        targetSampleRate?: number,
        forceMono: boolean = false,
    ): Promise<void> {
        this.isProcessing = true;
        this.progress = 0;
        this.error = null;
        this.images = [];

        try {
            const arrayBuffer = await file.arrayBuffer();
            let audioData: { channels: Float32Array[], sampleRate: number } | undefined = undefined;
            let binaryData: Uint8Array | undefined = undefined;

            // 1. Try to treat as audio
            if (file.type.startsWith('audio/') || file.type === "") {
                try {
                    const wavMetadata = getWavMetadata(arrayBuffer);
                    if (wavMetadata) {
                        const detectedSampleRate = wavMetadata.sampleRate;
                        const sampleRate = targetSampleRate ?? detectedSampleRate;

                        const offlineCtx = new OfflineAudioContext(wavMetadata.numberOfChannels, wavMetadata.totalSamples || 0, sampleRate);
                        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));

                        let channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
                        if (forceMono && channels.length > 1) {
                            const len = channels[0].length;
                            const mono = new Float32Array(len);
                            for (let i = 0; i < len; i++) {
                                let sum = 0;
                                for (let c = 0; c < channels.length; c++) sum += channels[c][i];
                                mono[i] = sum / channels.length;
                            }
                            channels = [mono];
                        }

                        audioData = {
                            channels,
                            sampleRate,
                        };
                    }
                } catch (e) {
                    console.warn("Audio decoding failed, falling back to binary encoding", e);
                }
            }

            if (!audioData) {
                binaryData = new Uint8Array(arrayBuffer);
            }

            const results = await PxfEncoder.encode(
                { audio: audioData, binary: binaryData },
                metadata,
                {},
                (pct: number) => this.progress = pct
            );

            this.images = await Promise.all(results.map(async (res: EncodedImageResult) => {
                const canvas = document.createElement('canvas');
                canvas.width = res.width;
                canvas.height = res.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error("Could not get 2D context");

                const imageData = new ImageData(res.data as any, res.width, res.height);
                ctx.putImageData(imageData, 0, 0);

                const blob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Failed to create blob'));
                    }, 'image/png');
                    // Timeout after 5 seconds
                    setTimeout(() => reject(new Error('toBlob timeout')), 5000);
                });

                return {
                    ...res,
                    blob
                };
            }));

        } catch (e: unknown) {
            this.error = e instanceof Error ? e.message : "Failed to process audio file.";
        } finally {
            this.isProcessing = false;
            this.progress = 0;
        }
    }

    private async resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
        const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, Math.ceil(audioBuffer.length * targetSampleRate / audioBuffer.sampleRate), targetSampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        return await offlineCtx.startRendering();
    }
}
