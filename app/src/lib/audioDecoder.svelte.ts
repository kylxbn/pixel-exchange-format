// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { AudioPlayer } from './audioPlayer.svelte';
import { PxfDecoder, type DecodeResult } from '@pixel-exchange-format/codec';
import { fileToRawImageData } from './imageUtils';
import * as m from '$lib/paraglide/messages';

export class AudioDecoderState {
	isProcessing = $state(false);
	error = $state<string | null>(null);
	result = $state<DecodeResult | null>(null);
	optimizedDecode = $state<boolean | null>(null);
	imageFiles = $state<File[]>([]);

	player = new AudioPlayer();

	private generation = 0;

	async processImages(files: FileList | File[]): Promise<void> {
		const generation = ++this.generation;

		this.isProcessing = true;
		this.error = null;
		this.result = null;
		this.optimizedDecode = null;
		this.player.stop();

		const fileArray = Array.from(files);
		this.imageFiles = fileArray;

		try {
			let optimized = true;
			const loaded = await Promise.all(
				fileArray.map(async (file) => {
					const [rawImg, isOptimized] = await fileToRawImageData(file);
					optimized &&= isOptimized;
					return { source: PxfDecoder.load(rawImg), file };
				})
			);

			loaded.sort((a, b) => a.source.imageIndex - b.source.imageIndex);
			const sources = loaded.map((entry) => entry.source);

			const decodeRes = await PxfDecoder.decodeMetadataOnly(sources);
			if (generation !== this.generation) return;

			if (decodeRes.type === 'audio') {
				// The codec may drop images that don't belong to the set; keep previews aligned with decoder.sources
				this.imageFiles = decodeRes.decoder.sources
					.map((source) => loaded.find((entry) => entry.source === source)?.file)
					.filter((file): file is File => file !== undefined);
			} else {
				this.imageFiles = loaded.map((entry) => entry.file);
			}
			this.optimizedDecode = optimized;
			this.result = decodeRes;
		} catch (err: unknown) {
			if (generation !== this.generation) return;
			this.error = err instanceof Error ? err.message : m.error_failed_to_load_images();
		} finally {
			if (generation === this.generation) {
				this.isProcessing = false;
			}
		}
	}

	async playDecodedAudio(): Promise<void> {
		if (this.result && this.result.type === 'audio') {
			await this.player.play(this.result.decoder);
		}
	}

	reset(): void {
		this.generation++;
		this.player.stop();
		this.isProcessing = false;
		this.result = null;
		this.error = null;
		this.optimizedDecode = null;
		this.imageFiles = [];
	}
}
