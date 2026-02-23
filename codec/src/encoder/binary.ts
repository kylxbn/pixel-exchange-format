// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { encodeBytesToBlocks, numberToBytes } from '../utils/audioUtils';
import { createRNG } from '../utils/rng';
import {
    BLOCK_SIZE, CHANNEL_MODE,
    IMAGE_WIDTH, BLOCKS_PER_ROW,
    FORMAT_VERSION,
    BINARY_ROW_DATA_CAPACITY, BINARY_DATA_BLOCKS_PER_ROW,
    BINARY_ROW_CRC_BYTES,
    BINARY_ROW_PARITY_BYTES,
} from '../constants';
import { crc32c } from '../utils/crc32';
import { binaryLdpc } from '../constants';
import { ChunkingUtils } from './chunking';
import { HeaderEncoder } from './header';
import { TextRenderer } from './text';
import { generateBinaryPermutation } from '../utils/shuffle';
import { encodePointToRGB } from '../utils/obb';

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
        const randomBytes = new Uint8Array(numberToBytes(randomGenerator.next32(), 4));

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
        const numDataRows = Math.ceil(fileSize / BINARY_ROW_DATA_CAPACITY);

        // Layout: Row 0=Header, Row 1=Text, Row 2...N=Data
        const totalRows = 2 + numDataRows;
        const width = IMAGE_WIDTH;
        const height = totalRows * BLOCK_SIZE;

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

        // --- Row 2+: Data ---
        const rowBytes = new Uint8Array(BINARY_ROW_DATA_CAPACITY);

        for (let r = 0; r < numDataRows; r++) {
            if (r % 50 === 0) {
                if (onProgress) onProgress((r / numDataRows) * 100);
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const rowStart = r * BINARY_ROW_DATA_CAPACITY;
            const rowEnd = Math.min(rowStart + BINARY_ROW_DATA_CAPACITY, fileSize);

            rowBytes.fill(0);
            rowBytes.set(data.subarray(rowStart, rowEnd), 0);

            this.encodeBinaryRow(imageData, r, rowBytes);
        }

        if (onProgress) onProgress(100);

        const suffix = totalImages > 1 ? `_${imageIndex}_${totalImages}.png` : '.png';

        return { data: buffer, width, height, name: (metadata.fn || 'file') + suffix };
    }

    public static encodeBinaryRow(imageData: SimpleImageData, rowIndex: number, rowBytes: Uint8Array): void {
        // rowBytes is now exactly 2480 bytes (padded if needed)

        // 1. LDPC Encode on SEQUENTIAL data
        // Encode 2480 bytes -> 3004 bytes
        // Parity is computed on sequential byte positions
        const encoded = binaryLdpc.encode(rowBytes);
        const parityBytes = encoded.slice(BINARY_ROW_DATA_CAPACITY); // 20 bytes

        // 2. Calculate CRC32 of original sequential data for integrity check
        const rowCrc = crc32c(rowBytes);

        // 3. Generate row-specific random permutation at 2-bit pair level
        // This happens AFTER LDPC so that when the decoder de-permutes,
        // burst errors from corrupted JPEG blocks become maximally scattered
        const permutation = generateBinaryPermutation(rowIndex);

        // Extract 2-bit pairs from sequential data and apply permutation
        // Total pairs: 2480 bytes * 4 pairs/byte = 9920 pairs
        const totalPairs = BINARY_ROW_DATA_CAPACITY * 4;
        const permutedPairs = new Uint8Array(BINARY_ROW_DATA_CAPACITY); // Initialize with zeros
        for (let pairIdx = 0; pairIdx < totalPairs; pairIdx++) {
            const sourcePairIdx = permutation[pairIdx];

            // Extract source 2-bit pair
            const sourceByteIdx = Math.floor(sourcePairIdx / 4);
            const sourcePairInByte = sourcePairIdx % 4;
            const sourceShift = 6 - sourcePairInByte * 2;
            const pair = (rowBytes[sourceByteIdx] >> sourceShift) & 0b11;

            // Write to permuted position
            const destByteIdx = Math.floor(pairIdx / 4);
            const destPairInByte = pairIdx % 4;
            const destShift = 6 - destPairInByte * 2;
            permutedPairs[destByteIdx] |= (pair << destShift);
        }

        // 4. Assemble Metadata Buffer (32 Bytes)
        // [0-27]: LDPC Parity (28 bytes) - computed on sequential (non-interleaved) data
        // [28-31]: CRC32 (4 bytes) - computed on sequential (non-interleaved) data
        const metaBuffer = new Uint8Array(BINARY_ROW_PARITY_BYTES + BINARY_ROW_CRC_BYTES);
        metaBuffer.set(parityBytes, 0);

        metaBuffer[BINARY_ROW_PARITY_BYTES] = (rowCrc >>> 24) & 0xFF;
        metaBuffer[BINARY_ROW_PARITY_BYTES + 1] = (rowCrc >>> 16) & 0xFF;
        metaBuffer[BINARY_ROW_PARITY_BYTES + 2] = (rowCrc >>> 8) & 0xFF;
        metaBuffer[BINARY_ROW_PARITY_BYTES + 3] = rowCrc & 0xFF;

        // 5. Write Data Blocks (124 Blocks) using YCbCr 4:2:0 encoding
        // Each block: 20 bytes = 160 bits
        //   - 16 bytes (128 bits) for 64 Y values (8x8 grid, 2 bits each)
        //   - 2 bytes (32 bits) for 16 Cb values (4x4 grid, 1 bit each)
        //   - 2 bytes (32 bits) for 16 Cr values (4x4 grid, 1 bit each)
        const startBlock = (rowIndex + 2) * BLOCKS_PER_ROW;
        const baseY = (rowIndex + 2) * 8;

        for (let b = 0; b < BINARY_DATA_BLOCKS_PER_ROW; b++) {
            const blockStart = b * 20; // 20 bytes per block now
            const bx = (b % BLOCKS_PER_ROW) * 8;

            // Extract Y, Cb, Cr data for this block
            const yBytes = permutedPairs.slice(blockStart, blockStart + 16); // 16 bytes = 64 Y values
            const cbBytes = permutedPairs.slice(blockStart + 16, blockStart + 18); // 2 bytes = 16 Cb values
            const crBytes = permutedPairs.slice(blockStart + 18, blockStart + 20); // 2 bytes = 16 Cr values

            // Process each pixel in the 8x8 block
            for (let py = 0; py < 8; py++) {
                for (let px = 0; px < 8; px++) {
                    // Get Y value for this pixel (8x8 grid)
                    const yIdx = py * 8 + px;
                    const yByteIdx = yIdx >>> 2; // Math.floor(yIdx / 4)
                    const yPairInByte = yIdx & 3; // yIdx % 4
                    const yShift = 6 - yPairInByte * 2;
                    const yBits = (yBytes[yByteIdx] >> yShift) & 0b11;

                    // Get Cb and Cr values (4x4 grid, 4:2:0 subsampling)
                    // Each chroma sample covers a 2x2 block of luma pixels
                    const cY = py >>> 1; // Math.floor(py / 2)
                    const cX = px >>> 1; // Math.floor(px / 2)
                    
                    // Okay, so now that we know the 4x4 index,
                    // we need to know which byte and which bit to write in Cb and Cr.
                    // The Cb plane contains 2 bytes, just like Cr.
                    const cByteIdx = cY >>> 1; // so cY == 0 -> byte 0, cY == 1 -> byte 0, cY == 2 -> byte 1, etc.
                    const cBit = 7 - cX - (cY & 0b1) * 4;

                    // Map bit to [-1..1] point space
                    const yPoint = this.grayCodeToPoint(yBits);
                    const cbPoint = ((cbBytes[cByteIdx] >>> cBit) & 0b1) ? 1 : -1;
                    const crPoint = ((crBytes[cByteIdx] >>> cBit) & 0b1) ? 1 : -1;

                    // Convert point to RGB using OBB (without mu-law for binary mode)
                    const rgb = encodePointToRGB([yPoint, cbPoint, crPoint], false);

                    // Clamp to valid RGB range and write pixel
                    const off = ((baseY + py) * IMAGE_WIDTH + (bx + px)) * 4;
                    imageData.data[off] = Math.max(0, Math.min(255, Math.round(rgb[0])));
                    imageData.data[off + 1] = Math.max(0, Math.min(255, Math.round(rgb[1])));
                    imageData.data[off + 2] = Math.max(0, Math.min(255, Math.round(rgb[2])));
                    imageData.data[off + 3] = 255;
                }
            }
        }

        // 6. Write Metadata Blocks (4 Blocks) using 1-bit encoding
        encodeBytesToBlocks(metaBuffer, imageData.data, IMAGE_WIDTH, startBlock + BINARY_DATA_BLOCKS_PER_ROW);
    }

    /**
     * Helper: Maps 2-bit Gray code to point value in [-1..1] range.
     * Gray code mapping (ensures adjacent values differ by only 1 bit):
     * 00 -> -1.0
     * 01 -> -0.333...
     * 11 -> +0.333...
     * 10 -> +1.0
     */
    private static grayCodeToPoint(bits: number): number {
        switch (bits) {
            case 0b00: return -1.0;
            case 0b01: return -1.0 / 3.0;
            case 0b11: return 1.0 / 3.0;
            case 0b10: return 1.0;
            default: return -1.0;
        }
    }
}
