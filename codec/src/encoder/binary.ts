// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { numberToBytes } from '../utils/audioUtils';
import { createRNG } from '../utils/rng';
import { BLOCK_SIZE, CHANNEL_MODE, IMAGE_WIDTH, FORMAT_VERSION } from '../constants';
import { crc32c } from '../utils/crc32';
import { ChunkingUtils } from './chunking';
import { HeaderEncoder } from './header';
import { TextRenderer } from './text';
import {
    BINARY_STRIP_DATA_CAPACITY, BINARY_STRIP_HEIGHT, LDPC_BINARY_N,
    generateBinaryScrambleMask, getBinaryLdpc, modulateStrip, renderStrip,
} from '../utils/binaryModulation';
import { getBinaryPermutation } from '../utils/shuffle';
import type { EncodedImageResult, SimpleImageData } from './types';

export class BinaryEncoder {
    public static async encodeBinary(
        data: Uint8Array,
        metadata: Record<string, string>,
        options: { maxHeight?: number } = {},
        onProgress?: (p: number) => void
    ): Promise<EncodedImageResult[]> {
        // Split binary data into chunks
        const chunks = ChunkingUtils.splitBinaryForMultiImage(data, options.maxHeight);
        const results: EncodedImageResult[] = [];

        // Generate random number using RNG
        const randomSeed = Math.floor(Math.random() * 2 ** 32);
        const randomGenerator = createRNG(randomSeed);
        const randomBytes = numberToBytes(randomGenerator.next32(), 4);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const progressCallback = onProgress ? (p: number) => onProgress((i + p / 100) / chunks.length * 100) : undefined;
            results.push(await this.encodeBinaryChunk(chunk, metadata, randomBytes, i + 1, chunks.length, data.length, progressCallback));
        }

        return results;
    }

    public static async encodeBinaryChunk(
        data: Uint8Array,
        metadata: Record<string, string>,
        randomBytes: Uint8Array,
        imageIndex: number,
        totalImages: number,
        totalSize: number,
        onProgress?: (p: number) => void
    ): Promise<EncodedImageResult> {
        const fileSize = data.length;
        const numStrips = Math.ceil(fileSize / BINARY_STRIP_DATA_CAPACITY);

        // Layout: Row 0=Header, Row 1=Text, then one 16px strip per codeword
        const headerHeight = 2 * BLOCK_SIZE;
        const width = IMAGE_WIDTH;
        const height = headerHeight + numStrips * BINARY_STRIP_HEIGHT;

        const buffer = new Uint8ClampedArray(width * height * 4);
        const imageData: SimpleImageData = { data: buffer, width, height };

        // Fill black
        buffer.fill(0);
        for (let i = 3; i < buffer.length; i += 4) buffer[i] = 255;

        // --- Row 0: Header ---
        HeaderEncoder.writeHeader(imageData, 0, fileSize, CHANNEL_MODE.BINARY, metadata, randomBytes, imageIndex, totalImages);

        // --- Row 1: Text Info ---
        const chunkSizeKB = (fileSize / 1024).toFixed(1);
        const totalSizeKB = (totalSize / 1024).toFixed(1);
        const filename = metadata.fn || 'UNTITLED.BIN';
        const comment = metadata.comment || '';

        let infoText = `PXF V${FORMAT_VERSION} BINARY   ${chunkSizeKB} KB (${totalSizeKB} KB)   IMG ${imageIndex}/${totalImages}   ${filename}`;
        if (comment) {
            infoText += `   ${comment}`;
        }
        TextRenderer.drawTextRow(TextRenderer.toDisplayText(infoText), imageData.data, width, 1);

        // --- Strips ---
        const stripBytes = new Uint8Array(BINARY_STRIP_DATA_CAPACITY);

        for (let s = 0; s < numStrips; s++) {
            if (s % 8 === 0) {
                if (onProgress) onProgress((s / numStrips) * 100);
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const start = s * BINARY_STRIP_DATA_CAPACITY;
            const end = Math.min(start + BINARY_STRIP_DATA_CAPACITY, fileSize);

            stripBytes.fill(0);
            stripBytes.set(data.subarray(start, end), 0);

            this.encodeBinaryStrip(imageData, s, stripBytes);
        }

        if (onProgress) onProgress(100);

        const suffix = totalImages > 1 ? `_${imageIndex}_${totalImages}.png` : '.png';

        return { data: buffer, width, height, name: (metadata.fn || 'file') + suffix };
    }

    public static encodeBinaryStrip(imageData: SimpleImageData, stripIndex: number, stripBytes: Uint8Array): void {
        // 1. Payload + CRC32C of the payload
        const message = new Uint8Array(BINARY_STRIP_DATA_CAPACITY + 4);
        message.set(stripBytes, 0);
        const crc = crc32c(stripBytes);
        message[BINARY_STRIP_DATA_CAPACITY] = (crc >>> 24) & 0xFF;
        message[BINARY_STRIP_DATA_CAPACITY + 1] = (crc >>> 16) & 0xFF;
        message[BINARY_STRIP_DATA_CAPACITY + 2] = (crc >>> 8) & 0xFF;
        message[BINARY_STRIP_DATA_CAPACITY + 3] = crc & 0xFF;

        // 2. LDPC encode, then whiten the whole codeword
        const codeword = getBinaryLdpc().encode(message);
        const mask = generateBinaryScrambleMask(stripIndex);
        for (let i = 0; i < codeword.length; i++) codeword[i] ^= mask[i];

        // 3. Interleave, so that a damaged block spreads over the codeword
        const permutation = getBinaryPermutation();
        const bits = new Uint8Array(LDPC_BINARY_N);
        for (let i = 0; i < LDPC_BINARY_N; i++) {
            const source = permutation[i];
            bits[i] = (codeword[source >>> 3] >> (7 - (source & 7))) & 1;
        }

        // 4. Bits -> DCT coefficients -> pixels
        const baseY = 2 * BLOCK_SIZE + stripIndex * BINARY_STRIP_HEIGHT;
        renderStrip(modulateStrip(bits), imageData.data, baseY);
    }
}
