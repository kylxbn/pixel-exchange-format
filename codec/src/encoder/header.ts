// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { encodeBytesToBlocks, numberToBytes } from '../utils/audioUtils';
import { createRNG } from '../utils/rng';
import {
    IMAGE_WIDTH,
    FORMAT_VERSION,
    HEADER_PAYLOAD_BYTES,
    MAX_STRING_DATA_BYTES,
    HEADER_XOR_MASK_SEED,
} from '../constants';
import { MurmurHash3_x64_128 } from '../utils/murmurHash';
import { headerLdpc } from '../constants';

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

export class HeaderEncoder {
    public static writeHeader(
        imageData: SimpleImageData,
        sampleRate: number, // reused for filesize in binary
        fileSizeSamples: number,
        channelMode: number,
        metadata: Record<string, string>,
        randomBytes: Uint8Array,
        imageIndex: number,
        totalImages: number
    ) {
        const payload = new Uint8Array(HEADER_PAYLOAD_BYTES); // 768 bytes

        // Serialize metadata
        const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
        const textEncoder = new TextEncoder();
        const metadataBuffer = new Uint8Array(MAX_STRING_DATA_BYTES);
        let ptr = 0;
        metadataBuffer[ptr++] = entries.length;
        for (const [key, value] of entries) {
            const keyBytes = textEncoder.encode(key);
            const valueBytes = textEncoder.encode(value);
            const lenWord = (keyBytes.length << 12) | valueBytes.length;
            metadataBuffer[ptr++] = lenWord >> 8;
            metadataBuffer[ptr++] = lenWord & 0xFF;
            for (const b of keyBytes) metadataBuffer[ptr++] = b;
            for (const b of valueBytes) metadataBuffer[ptr++] = b;
        }
        const metadataLen = ptr;

        let offset = 0;
        payload.set(numberToBytes(FORMAT_VERSION, 2), offset); offset += 2;
        payload.set(numberToBytes(sampleRate, 4), offset); offset += 4;
        payload.set(numberToBytes(fileSizeSamples, 4), offset); offset += 4;
        payload.set(numberToBytes(metadataLen, 2), offset); offset += 2;
        payload.set(numberToBytes(channelMode, 1), offset); offset += 1;
        payload.set(randomBytes, offset); offset += 4;
        payload.set(numberToBytes(imageIndex, 2), offset); offset += 2;
        payload.set(numberToBytes(totalImages, 2), offset); offset += 2;
        payload.set(metadataBuffer.slice(0, metadataLen), offset);

        // LDPC Encode Full Header
        // 768 bytes -> 1024 bytes
        const fullHeaderRow = headerLdpc.encode(payload);

        // XOR Mask AFTER LDPC encoding, BEFORE writing to pixels (for whitening)
        const headerMaskGen = createRNG(HEADER_XOR_MASK_SEED);
        for (let i = 0; i < fullHeaderRow.length; i++) {
            fullHeaderRow[i] ^= headerMaskGen.nextByte();
            fullHeaderRow[i] ^= headerMaskGen.nextByte();
        }

        encodeBytesToBlocks(fullHeaderRow, imageData.data, IMAGE_WIDTH, 0);

        // Get the checksum of the header
        const headerChecksum = MurmurHash3_x64_128.hash(payload.slice(0, 21))
        const stringChecksum = MurmurHash3_x64_128.hash(payload.slice(21));
        const payloadChecksum = new Uint8Array(32);
        payloadChecksum.set(headerChecksum, 0);
        payloadChecksum.set(stringChecksum, 16);
        encodeBytesToBlocks(payloadChecksum, imageData.data, IMAGE_WIDTH, 128 * 2 - 4);
    }
}
