// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * WAV file data structure
 */
export interface WavData {
    channels: Float32Array[];
    sampleRate: number;
    numberOfChannels: number;
    bitsPerSample: number;
    audioFormat: number;
}

interface WavMetadata {
    audioFormat: number;
    numberOfChannels: number;
    sampleRate: number;
    bitsPerSample: number;
    dataOffset: number;
    dataByteLength: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

/**
 * Parses the RIFF/WAVE chunk structure to locate the format and data chunks.
 * Returns null if the buffer is not a WAV file or lacks either chunk.
 */
function getWavMetadata(arrayBuffer: ArrayBuffer): WavMetadata | null {
    const view = new DataView(arrayBuffer);

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

    while (offset + 8 <= view.byteLength) {
        const chunkId = view.getUint32(offset, false);
        const chunkSize = view.getUint32(offset + 4, true);
        const chunkDataOffset = offset + 8;

        if (chunkId === 0x666d7420) { // "fmt "
            if (chunkSize < 16 || chunkDataOffset + 16 > view.byteLength) return null;

            audioFormat = view.getUint16(chunkDataOffset + 0, true);
            numberOfChannels = view.getUint16(chunkDataOffset + 2, true);
            sampleRate = view.getUint32(chunkDataOffset + 4, true);
            bitsPerSample = view.getUint16(chunkDataOffset + 14, true);

            // WAVE_FORMAT_EXTENSIBLE: real format is the first 2 bytes of the SubFormat GUID
            if (audioFormat === WAVE_FORMAT_EXTENSIBLE && chunkSize >= 40 && chunkDataOffset + 26 <= view.byteLength) {
                audioFormat = view.getUint16(chunkDataOffset + 24, true);
            }
        } else if (chunkId === 0x64617461) { // "data"
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

    return {
        audioFormat,
        numberOfChannels,
        sampleRate,
        bitsPerSample,
        dataOffset,
        dataByteLength
    };
}

/**
 * Decodes a WAV file buffer into raw PCM audio data
 * @param buffer - WAV file buffer
 * @returns Decoded audio data with channels and metadata
 */
export function decodeWav(buffer: ArrayBuffer): WavData {
    const metadata = getWavMetadata(buffer);

    if (!metadata) {
        throw new Error('Invalid WAV file format');
    }

    const { sampleRate, numberOfChannels, bitsPerSample, audioFormat, dataOffset } = metadata;

    if (audioFormat !== WAVE_FORMAT_PCM && audioFormat !== WAVE_FORMAT_IEEE_FLOAT) {
        throw new Error(`Unsupported WAV format tag: 0x${audioFormat.toString(16)} (only PCM and IEEE float are supported)`);
    }
    if (numberOfChannels < 1) {
        throw new Error('Invalid WAV file: zero channels');
    }
    if (sampleRate < 1) {
        throw new Error('Invalid WAV file: zero sample rate');
    }

    const isFloat = audioFormat === WAVE_FORMAT_IEEE_FLOAT;
    const supportedDepths = isFloat ? [32, 64] : [8, 16, 24, 32];
    if (!supportedDepths.includes(bitsPerSample)) {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}-bit ${isFloat ? 'float' : 'PCM'}`);
    }

    const blockAlign = numberOfChannels * (bitsPerSample / 8);
    // Clamp to the actual buffer: handles streaming (0xFFFFFFFF) sizes and truncated files
    const dataSize = Math.min(metadata.dataByteLength, buffer.byteLength - dataOffset);
    const numSamples = Math.floor(dataSize / blockAlign);

    const view = new DataView(buffer);
    const channels: Float32Array[] = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(numSamples)
    );

    let dataIndex = dataOffset;

    if (isFloat && bitsPerSample === 32) {
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = view.getFloat32(dataIndex, true);
                dataIndex += 4;
            }
        }
    } else if (isFloat) {
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = view.getFloat64(dataIndex, true);
                dataIndex += 8;
            }
        }
    } else if (bitsPerSample === 16) {
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = view.getInt16(dataIndex, true) / 32768.0;
                dataIndex += 2;
            }
        }
    } else if (bitsPerSample === 24) {
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const byte1 = view.getUint8(dataIndex);
                const byte2 = view.getUint8(dataIndex + 1);
                const byte3 = view.getUint8(dataIndex + 2);

                // Combine and sign-extend via arithmetic shift
                const sample = ((byte3 << 24) | (byte2 << 16) | (byte1 << 8)) >> 8;

                channels[ch][i] = sample / 8388608.0;
                dataIndex += 3;
            }
        }
    } else if (bitsPerSample === 32) {
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = view.getInt32(dataIndex, true) / 2147483648.0;
                dataIndex += 4;
            }
        }
    } else {
        // 8-bit PCM is unsigned
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = (view.getUint8(dataIndex) - 128) / 128.0;
                dataIndex += 1;
            }
        }
    }

    return {
        channels,
        sampleRate,
        numberOfChannels,
        bitsPerSample,
        audioFormat
    };
}

/**
 * Encodes audio channels to 16-bit PCM WAV.
 * @param channels - Array of Float32Array audio channels (-1 to 1 range)
 * @param sampleRate - Sample rate in Hz
 * @returns WAV file as Uint8Array
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
    const numChannels = channels.length;
    const length = channels[0].length;
    const dataSize = length * numChannels * 2;
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, WAVE_FORMAT_PCM, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const s = Math.max(-1, Math.min(1, channels[channel][i]));
            view.setInt16(offset, Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), true);
            offset += 2;
        }
    }

    return new Uint8Array(wavBuffer);
}
