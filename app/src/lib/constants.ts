// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

// Constants
// Basically, these are the same ones in the codec implementation.
// But since I kinda feel like letting the codec export these internal details
// is kinda... wrong, I guess. I decided to just add them independently here in the UI as well.

// Physical & Algorithmic Constants
export const BLOCK_SIZE = 8;
export const IMAGE_WIDTH = 1024;
export const BLOCKS_PER_ROW = IMAGE_WIDTH / BLOCK_SIZE; // 128
export const META_BLOCKS_PER_ROW = 4;
export const DATA_BLOCKS_PER_ROW = BLOCKS_PER_ROW - META_BLOCKS_PER_ROW; // 124
export const MDCT_HOP_SIZE = 128; // MDCT hop size for SBR (128 bins total, 96 stored + 32 analyzed for SBR)

// Header Layout
export const HEADER_PAYLOAD_BYTES = 768; // Data
export const HEADER_FIXED_BYTES = 21;
export const MAX_STRING_DATA_BYTES = HEADER_PAYLOAD_BYTES - HEADER_FIXED_BYTES; // 747

// Binary Mode Constants
export const BINARY_DATA_BLOCKS_PER_ROW = 124;
export const BINARY_ROW_DATA_CAPACITY = BINARY_DATA_BLOCKS_PER_ROW * 16; // 2000 bytes

export function calculateMaxSamplesPerImage(maxHeight: number = 4096): number {
    const maxBlockRows = Math.floor(maxHeight / BLOCK_SIZE);
    const maxTotalBlocks = maxBlockRows * BLOCKS_PER_ROW;
    const firstAudioBlockIndex = 2 * BLOCKS_PER_ROW;
    const maxAudioBlocks = maxTotalBlocks - firstAudioBlockIndex;
    const maxImageRows = Math.floor(maxAudioBlocks / BLOCKS_PER_ROW);
    const maxTotalImageBlocks = maxImageRows * DATA_BLOCKS_PER_ROW;
    return maxTotalImageBlocks * MDCT_HOP_SIZE;
}

// Channel Modes
export const CHANNEL_MODE = {
    MONO: 0,
    STEREO_MID: 1,
    STEREO_SIDE: 2,
    BINARY: 3
} as const;

// SBR Constants
export const SBR_SUBGROUPS_PER_ROW = 2;

/**
 * Patch Mode Names for SBR patchMode parameter (0-3)
 */
export const PATCH_MODE_NAMES = [
    'Adjacent',
    'Lower',
    'Bass',
    'Mirror'
];

/**
 * Processing Mode Names for SBR procMode parameter (0-3)
 */
export const PROCESSING_MODE_NAMES = [
    'Normal',
    'Transient',
    'Harmonic',
    'Inverse'
];

/**
 * Transient Shape Names (Normal mode only)
 */
export const TRANSIENT_SHAPE_NAMES = [
    'Flat',
    'Attack',
    'Decay',
    'Impulse'
];

// SBR Data Structures - Normal Mode (full precision)
export interface SBRParams {
    temporalMode: false;
    hfGain: number;           // dB (-48 to +15)
    bandEnvelope: number[];   // 4 bands, dB relative
    noiseFloorRatio: number;  // 0-15
    tonality: number;         // 0-7
    patchMode: number;        // 0-3
    procMode: number;         // 0-3
    transientShape: number;   // 0-3
}

// SBR Data Structures - Temporal Mode (2x update rate)
export interface SBRParamsTemporal {
    temporalMode: true;
    patchMode: number;        // 0-3 (shared)
    procMode: number;         // 0-3 (shared)
    tonality: number;         // 0-3 (reduced)
    bandEnvelope: number[];   // 4 bands (reduced precision)
    hfGainA: number;          // First half gain
    noiseFloorRatioA: number; // First half noise
    transientA: number;       // First half transient
    hfGainB: number;          // Second half gain
    noiseFloorRatioB: number; // Second half noise
    transientB: number;       // Second half transient
}

export type SBRParamsUnion = SBRParams | SBRParamsTemporal;

export interface RowSBRParams {
    subgroups: [SBRParamsUnion, SBRParamsUnion];
}

// SBR Functions - Decode 32-bit words
const GAIN_STEP_DB_NORMAL = 1.0;
const GAIN_STEP_DB_TEMPORAL = 2.0;
const MIN_GAIN_DB = -48.0;
const BAND_ENV_STEP_DB_NORMAL = 2.0;
const BAND_ENV_STEP_DB_TEMPORAL = 3.0;
const BAND_ENV_MIN_DB = -6.0;
const BAND_ENV_MIN_DB_TEMPORAL = -4.5;

function decodeSBRWordNormal(word: number): SBRParams {
    const gainIdx = (word >>> 26) & 0x3F;
    const bandBits = (word >>> 14) & 0xFFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 3)) & 0x07;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_NORMAL) + BAND_ENV_MIN_DB);
    }

    return {
        temporalMode: false,
        hfGain: (gainIdx * GAIN_STEP_DB_NORMAL) + MIN_GAIN_DB,
        bandEnvelope,
        noiseFloorRatio: (word >>> 10) & 0x0F,
        tonality: (word >>> 7) & 0x07,
        patchMode: (word >>> 5) & 0x03,
        procMode: (word >>> 3) & 0x03,
        transientShape: (word >>> 1) & 0x03
    };
}

function decodeSBRWordTemporal(word: number): SBRParamsTemporal {
    const bandBits = (word >>> 18) & 0xFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 2)) & 0x03;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_TEMPORAL) + BAND_ENV_MIN_DB_TEMPORAL);
    }

    return {
        temporalMode: true,
        patchMode: (word >>> 30) & 0x03,
        procMode: (word >>> 28) & 0x03,
        tonality: (word >>> 26) & 0x03,
        bandEnvelope,
        hfGainA: (((word >>> 13) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioA: (word >>> 11) & 0x03,
        transientA: (word >>> 10) & 0x01,
        hfGainB: (((word >>> 5) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioB: (word >>> 3) & 0x03,
        transientB: (word >>> 2) & 0x01
    };
}

export function decodeSBRWord(word: number): SBRParamsUnion {
    const modeFlag = word & 1;
    if (modeFlag === 1) {
        return decodeSBRWordTemporal(word);
    } else {
        return decodeSBRWordNormal(word);
    }
}

export function decodeRowSBR(bytes: Uint8Array): RowSBRParams {
    if (bytes.length !== 8) {
        throw new Error("Invalid SBR bytes length");
    }
    const subgroups: SBRParamsUnion[] = [];
    for (let i = 0; i < SBR_SUBGROUPS_PER_ROW; i++) {
        // 4 bytes per word (32-bit), big-endian
        const word = (bytes[i * 4] << 24) | (bytes[i * 4 + 1] << 16) |
            (bytes[i * 4 + 2] << 8) | bytes[i * 4 + 3];
        subgroups.push(decodeSBRWord(word));
    }
    return { subgroups: subgroups as [SBRParamsUnion, SBRParamsUnion] };
}

// Audio Utility Functions
export const BAND_MAX_GAIN = 2.0;
const LOG2E = 1 / Math.LN2;
const LOG_MAX = Math.log1p(BAND_MAX_GAIN) * LOG2E;

export function logEncode(val: number): number {
    if (val <= 0) return 0;

    const safeVal = Math.min(val, BAND_MAX_GAIN);

    const encoded =
        Math.round(
            255 * (Math.log1p(safeVal) * LOG2E) / LOG_MAX
        );

    return Math.max(0, Math.min(255, encoded));
}

/**
 * WAV file data structure
 */
export interface WavMetadata {
    audioFormat: number;
    numberOfChannels: number;
    sampleRate: number;
    bitsPerSample: number;
    dataOffset: number;
    dataByteLength: number;
    totalSamples: number | null;
}

/**
 * Parses WAV file header to extract simple metadata.
 * Assumes standard RIFF WAVE format (PCM).
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
        dataOffset === null ||
        dataByteLength === null
    ) {
        return null;
    }

    // ---- Total samples ----
    let totalSamples: number | null = null;
    if (audioFormat === 1) { // PCM
        const bytesPerSample = bitsPerSample / 8;
        totalSamples =
            dataByteLength / (numberOfChannels * bytesPerSample);
    }

    return {
        audioFormat,
        numberOfChannels,
        sampleRate,
        bitsPerSample,
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
            let s = Math.max(-1, Math.min(1, channels[channel][i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Uint8Array(wavBuffer);
}
