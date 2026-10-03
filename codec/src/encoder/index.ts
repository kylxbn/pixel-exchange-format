// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { MAX_METADATA_KEY_BYTES, MAX_METADATA_VALUE_BYTES, MAX_STRING_DATA_BYTES } from '../constants';
import { AudioEncoder } from './audio';
import { BinaryEncoder } from './binary';
import type { AudioData, EncodedImageResult, EncodeOptions } from './types';

export type { AudioData, EncodedImageResult, EncodeOptions, SimpleImageData } from './types';

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
            if (keyBytes.length > MAX_METADATA_KEY_BYTES) {
                throw new Error(`Metadata key "${key}" is too long (${keyBytes.length} bytes, max ${MAX_METADATA_KEY_BYTES}).`);
            }
            if (valueBytes.length > MAX_METADATA_VALUE_BYTES) {
                throw new Error(`Metadata value for "${key}" is too long (${valueBytes.length} bytes, max ${MAX_METADATA_VALUE_BYTES}).`);
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
