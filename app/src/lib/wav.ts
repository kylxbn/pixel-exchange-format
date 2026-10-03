// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * WAV file data structure
 */
export interface WavMetadata {
	audioFormat: number;
	numberOfChannels: number;
	sampleRate: number;
	bitsPerSample: number;
	blockAlign: number;
	dataOffset: number;
	dataByteLength: number;
	totalSamples: number | null;
}

/**
 * Parses WAV file header to extract simple metadata.
 * Assumes standard RIFF WAVE format.
 */
export const getWavMetadata = (arrayBuffer: ArrayBuffer): WavMetadata | null => {
	const view = new DataView(arrayBuffer);

	// ---- RIFF header ----
	if (view.byteLength < 12) return null;
	if (view.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
	if (view.getUint32(8, false) !== 0x57415645) return null; // "WAVE"

	let offset = 12;

	let audioFormat: number | null = null;
	let numberOfChannels: number | null = null;
	let sampleRate: number | null = null;
	let bitsPerSample: number | null = null;
	let blockAlign: number | null = null;

	let dataOffset: number | null = null;
	let dataByteLength: number | null = null;

	// ---- Walk chunks ----
	while (offset + 8 <= view.byteLength) {
		const chunkId = view.getUint32(offset, false);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkDataOffset = offset + 8;

		// "fmt "
		if (chunkId === 0x666d7420) {
			audioFormat = view.getUint16(chunkDataOffset + 0, true);
			numberOfChannels = view.getUint16(chunkDataOffset + 2, true);
			sampleRate = view.getUint32(chunkDataOffset + 4, true);
			blockAlign = view.getUint16(chunkDataOffset + 12, true);
			bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
		}

		// "data"
		else if (chunkId === 0x64617461) {
			dataOffset = chunkDataOffset;
			dataByteLength = chunkSize;
		}

		// Chunks are padded to even sizes
		offset = chunkDataOffset + chunkSize + (chunkSize & 1);
	}

	if (
		audioFormat === null ||
		numberOfChannels === null ||
		sampleRate === null ||
		bitsPerSample === null ||
		blockAlign === null ||
		dataOffset === null ||
		dataByteLength === null
	) {
		return null;
	}

	// ---- Total samples ----
	const totalSamples = blockAlign > 0 ? Math.floor(dataByteLength / blockAlign) : null;

	return {
		audioFormat,
		numberOfChannels,
		sampleRate,
		bitsPerSample,
		blockAlign,
		dataOffset,
		dataByteLength,
		totalSamples
	};
};

/**
 * Encodes audio channels to WAV format.
 * @param channels - Array of Float32Array audio channels (-1 to 1 range)
 * @param sampleRate - Sample rate in Hz
 * @returns WAV file as Uint8Array
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
	const numChannels = channels.length;
	const length = channels[0].length;
	const wavBuffer = new ArrayBuffer(44 + length * numChannels * 2);
	const view = new DataView(wavBuffer);

	const writeString = (v: DataView, offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			v.setUint8(offset + i, str.charCodeAt(i));
		}
	};

	// RIFF identifier
	writeString(view, 0, 'RIFF');
	// file length
	view.setUint32(4, 36 + length * numChannels * 2, true);
	// RIFF type
	writeString(view, 8, 'WAVE');
	// format chunk identifier
	writeString(view, 12, 'fmt ');
	// format chunk length
	view.setUint32(16, 16, true);
	// sample format (raw)
	view.setUint16(20, 1, true);
	// channel count
	view.setUint16(22, numChannels, true);
	// sample rate
	view.setUint32(24, sampleRate, true);
	// byte rate (sample rate * block align)
	view.setUint32(28, sampleRate * numChannels * 2, true);
	// block align (channel count * bytes per sample)
	view.setUint16(32, numChannels * 2, true);
	// bits per sample
	view.setUint16(34, 16, true);
	// data chunk identifier
	writeString(view, 36, 'data');
	// data chunk length
	view.setUint32(40, length * numChannels * 2, true);

	// write the PCM samples
	let offset = 44;
	for (let i = 0; i < length; i++) {
		for (let channel = 0; channel < numChannels; channel++) {
			const s = Math.max(-1, Math.min(1, channels[channel][i]));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			offset += 2;
		}
	}

	return new Uint8Array(wavBuffer);
}
