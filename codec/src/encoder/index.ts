// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { MAX_STRING_DATA_BYTES } from '../constants';
import { AudioEncoder } from './audio';
import { BinaryEncoder } from './binary';

export interface EncodedImageResult {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    name: string;
}

export interface AudioData {
    channels: Float32Array[];
    sampleRate: number;
}

export interface SimpleImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface EncodeOptions {
    maxHeight?: number;
}

export class PxfEncoder {
    public static async encode(
        data: {
            audio?: AudioData,
            binary?: Uint8Array
        },
        metadata: Record<string, string> = {},
        options: EncodeOptions = {},
        onProgress?: (percent: number) => void
    ): Promise<EncodedImageResult[]> {
        // Validate metadata
        const entries = Object.entries(metadata);
        if (entries.length > 255) {
            throw new Error("Too many metadata entries (max 255).");
        }
        const textEncoder = new TextEncoder();
        let totalMetadataBytes = 1; // numPairs
        for (const [key, value] of entries) {
            const keyBytes = textEncoder.encode(key);
            const valueBytes = textEncoder.encode(value);
            if (keyBytes.length > 15) {
                throw new Error(`Metadata key "${key}" is too long (${keyBytes.length} bytes, max 15).`);
            }
            if (valueBytes.length > 4095) {
                throw new Error(`Metadata value for "${key}" is too long (${valueBytes.length} bytes, max 4095).`);
            }
            totalMetadataBytes += 2 + keyBytes.length + valueBytes.length;
        }
        if (totalMetadataBytes > MAX_STRING_DATA_BYTES) {
            throw new Error(`Metadata too large (${totalMetadataBytes} bytes, max ${MAX_STRING_DATA_BYTES}).`);
        }

        if (data.audio) {
            return AudioEncoder.encodeAudio(data.audio.channels, data.audio.sampleRate, metadata, options, onProgress);
        } else if (data.binary) {
            return BinaryEncoder.encodeBinary(data.binary, metadata, options, onProgress);
        } else {
            throw new Error("No data provided to encode.");
        }
    }
}
