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

/**
 * Resample audio data using sinc interpolation
 * @param input - Input audio data
 * @param targetSampleRate - Target sample rate
 * @returns Resampled audio data
 */
export function resampleAudio(input: WavData, targetSampleRate: number): WavData {
    const ratio = targetSampleRate / input.sampleRate;

    if (Math.abs(ratio - 1.0) < 1e-6) {
        // No resampling needed
        return { ...input };
    }

    const outputLength = Math.floor(input.channels[0].length * ratio);
    const outputChannels: Float32Array[] = input.channels.map(() =>
        new Float32Array(outputLength)
    );

    // Sinc resampling parameters
    const sincFilterLength = 32; // Filter length (must be even)
    const halfFilterLength = sincFilterLength / 2;

    for (let ch = 0; ch < input.numberOfChannels; ch++) {
        const inputChannel = input.channels[ch];
        const outputChannel = outputChannels[ch];

        for (let outIndex = 0; outIndex < outputLength; outIndex++) {
            const inputIndex = outIndex / ratio;
            let sum = 0;
            let weightSum = 0;

            // Apply sinc filter
            for (let i = -halfFilterLength; i <= halfFilterLength; i++) {
                const sampleIndex = Math.floor(inputIndex) + i;

                if (sampleIndex >= 0 && sampleIndex < inputChannel.length) {
                    const x = inputIndex - sampleIndex;
                    const sincValue = sinc(x);
                    const windowValue = hammingWindow(x / halfFilterLength);

                    const weight = sincValue * windowValue;
                    sum += inputChannel[sampleIndex] * weight;
                    weightSum += weight;
                }
            }

            outputChannel[outIndex] = weightSum > 0 ? sum / weightSum : 0;
        }
    }

    return {
        channels: outputChannels,
        sampleRate: targetSampleRate,
        numberOfChannels: input.numberOfChannels,
        bitsPerSample: input.bitsPerSample,
        audioFormat: input.audioFormat
    };
}

/**
 * Sinc function: sin(pi*x) / (pi*x)
 */
function sinc(x: number): number {
    if (Math.abs(x) < 1e-6) return 1.0;
    return Math.sin(Math.PI * x) / (Math.PI * x);
}

/**
 * Hamming window function for filter
 */
function hammingWindow(x: number): number {
    return 0.54 - 0.46 * Math.cos(Math.PI * (x + 1));
}

/**
 * Parses WAV file header to extract simple metadata.
 * Assumes standard RIFF WAVE format (PCM).
 */
export interface WavMetadata {
    audioFormat: number;
    numberOfChannels: number;
    sampleRate: number;
    bitsPerSample: number;
    dataOffset: number;
    dataByteLength: number;
    totalSamples: number|null;
}

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
 * Decodes a WAV file buffer into raw PCM audio data
 * @param buffer - WAV file buffer
 * @returns Decoded audio data with channels and metadata
 */
export function decodeWav(buffer: ArrayBuffer): WavData {
    // Use the codec's metadata extraction
    const metadata = getWavMetadata(buffer);

    if (!metadata) {
        throw new Error('Invalid WAV file format');
    }

    const { sampleRate, numberOfChannels, bitsPerSample, audioFormat } = metadata;

    // Find the data chunk
    const view = new DataView(buffer);
    let offset = 12; // Skip RIFF header

    let dataOffset = -1;
    let dataSize = 0;

    // Search for data chunk
    while (offset < buffer.byteLength - 8) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
    }

    if (dataOffset === -1) {
        throw new Error('WAV data chunk not found');
    }

    // Decode PCM data based on bit depth
    const channels: Float32Array[] = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(dataSize / (numberOfChannels * (bitsPerSample / 8)))
    );

    const numSamples = channels[0].length;
    let dataIndex = dataOffset;

    if (bitsPerSample === 16) {
        // 16-bit PCM
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const sample = view.getInt16(dataIndex, true);
                channels[ch][i] = sample / 32768.0; // Normalize to [-1, 1]
                dataIndex += 2;
            }
        }
    } else if (bitsPerSample === 24) {
        // 24-bit PCM
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                // Read 3 bytes for 24-bit sample
                const byte1 = view.getUint8(dataIndex);
                const byte2 = view.getUint8(dataIndex + 1);
                const byte3 = view.getUint8(dataIndex + 2);

                // Combine into signed 24-bit value
                let sample = (byte3 << 16) | (byte2 << 8) | byte1;

                // Sign extend if negative
                if (sample & 0x800000) {
                    sample |= 0xFF000000;
                }

                channels[ch][i] = sample / 8388608.0; // Normalize to [-1, 1]
                dataIndex += 3;
            }
        }
    } else if (bitsPerSample === 32 && audioFormat === 3) {
        // 32-bit float PCM
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channels[ch][i] = view.getFloat32(dataIndex, true);
                dataIndex += 4;
            }
        }
    } else if (bitsPerSample === 32) {
        // 32-bit integer PCM
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const sample = view.getInt32(dataIndex, true);
                channels[ch][i] = sample / 2147483648.0; // Normalize to [-1, 1]
                dataIndex += 4;
            }
        }
    } else if (bitsPerSample === 8) {
        // 8-bit PCM (unsigned)
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const sample = view.getUint8(dataIndex);
                channels[ch][i] = (sample - 128) / 128.0; // Normalize to [-1, 1]
                dataIndex += 1;
            }
        }
    } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}-bit`);
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
