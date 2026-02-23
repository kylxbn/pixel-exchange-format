// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { AudioPlayer } from './audioPlayer.svelte';
import { PxfDecoder, type DecodeResult } from '@pixel-exchange-format/codec';
import { fileToRawImageData } from './imageUtils';

export class AudioDecoderState {
    isProcessing = $state(false);
    error = $state<string | null>(null);
    status = $state<string | null>(null);
    result = $state<DecodeResult | null>(null);
    optimizedDecode = $state<boolean | null>(null);

    player = new AudioPlayer();

    async processImages(files: FileList | File[]): Promise<void> {
        this.isProcessing = true;
        this.error = null;
        this.status = "Reading metadata...";
        this.player.stop();

        try {
            const fileArray = Array.from(files);

            // Load all images and extract raw pixel data
            const sources = await Promise.all(fileArray.map(async file => {
                const [rawImg, optimized] = await fileToRawImageData(file);
                this.optimizedDecode = optimized;
                return PxfDecoder.load(rawImg);
            }));

            const decodeRes = await PxfDecoder.decodeMetadataOnly(sources);
            this.result = decodeRes;
            this.status = null;
        } catch (err: unknown) {
            this.error = err instanceof Error ? err.message : "Failed to load image(s).";
            this.status = null;
        } finally {
            this.isProcessing = false;
        }
    }

    async playDecodedAudio(): Promise<void> {
        if (this.result && this.result.type === 'audio') {
            await this.player.play(this.result.decoder);
        }
    }

    reset(): void {
        this.player.stop();
        this.result = null;
        this.error = null;
        this.status = null;
        this.optimizedDecode = null;
    }
}
