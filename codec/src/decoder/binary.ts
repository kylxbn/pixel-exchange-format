// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { decodeBytesFromBlocks } from '../utils/audioUtils';
import {
    BLOCKS_PER_ROW, BINARY_DATA_BLOCKS_PER_ROW, BINARY_ROW_DATA_CAPACITY, BINARY_ROW_META_BYTES,
    BINARY_ROW_PARITY_BYTES,
    LDPC_BINARY_N, LDPC_BINARY_K,
} from '../constants';
import { crc32c } from '../utils/crc32';
import { binaryLdpc } from '../constants';
import { PxfDecoder } from '.';
import { generateBinaryPermutation } from '../utils/shuffle';
import { decodeBinaryRGBToPoint } from '../utils/obb';
import { LLR_LOOKUP_2BIT, LLR_LOOKUP_1BIT_CHROMA } from './models/generic';

export interface BinaryResult {
    type: 'binary';
    data: Uint8Array;
    metadata: Record<string, string>;
    visualizationMetadata: VisualizationMetadata;
    validChecksum: boolean;
}

export interface BinaryDecodeDebugCapture {
    rowHealth: number[];
    overallHealth?: number;
}

export interface VisualizationMetadata {
    hopSize: number;
    firstAudioBlockIndex: number;
    sampleRate: number;
    blocksPerRow: number;
    totalAudioBlocks: number;
    version: number;
}

export interface ImageSource {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    channelMode: number;
    visualizationMetadata: VisualizationMetadata;
    totalSamples: number;
    sampleRate: number;
    metadata: Record<string, string>;
    randomBytes: Uint8Array;
    imageIndex: number;
    totalImages: number;
}


export class BinaryDecoder {
    public static async decodeBinaryImages(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<BinaryResult> {
        // Sort sources by imageIndex
        sources.sort((a, b) => a.imageIndex - b.imageIndex);

        // Calculate total file size from all chunks
        let totalFileSize = 0;
        let totalRows = 0;
        for (const source of sources) {
            totalFileSize += source.totalSamples; // totalSamples contains chunk size for binary
            totalRows += Math.ceil(source.totalSamples / BINARY_ROW_DATA_CAPACITY);
        }

        const data = new Uint8Array(totalFileSize);
        let validChecksum = true;
        let dataOffset = 0;
        let rowOffset = 0;

        let totalBits = 0;
        let totalHealthyBits = 0;

        if (debugCapture) {
            debugCapture.rowHealth = new Array(totalRows);
            debugCapture.overallHealth = 0;
        }

        // Decode each image and concatenate the data
        for (const source of sources) {
            const chunkResult = await this.decodeBinaryChunk(source, debugCapture, rowOffset);
            if (!chunkResult.validChecksum) {
                validChecksum = false;
            }
            data.set(chunkResult.data, dataOffset);
            dataOffset += chunkResult.data.length;
            rowOffset += chunkResult.rowsDecoded;

            if (debugCapture) {
                totalBits += chunkResult.totalBits;
                totalHealthyBits += chunkResult.totalHealthyBits;
            }
        }

        if (debugCapture) {
            debugCapture.overallHealth = totalBits > 0 ? (totalHealthyBits / totalBits) * 100 : 0;
        }

        return {
            type: 'binary',
            data,
            visualizationMetadata: sources[0].visualizationMetadata,
            metadata: sources[0].metadata,
            validChecksum
        };
    }

    public static async decodeBinaryChunk(
        source: ImageSource,
        debugCapture?: BinaryDecodeDebugCapture | null,
        rowOffset: number = 0
    ): Promise<{ data: Uint8Array, validChecksum: boolean, rowsDecoded: number, totalBits: number, totalHealthyBits: number }> {
        const fileSize = source.totalSamples; // Stored in totalSamples field
        const numDataRows = Math.ceil(fileSize / BINARY_ROW_DATA_CAPACITY);
        const data = new Uint8Array(fileSize);
        let validChecksum = true;
        let totalBits = 0;
        let totalHealthyBits = 0;

        if (debugCapture) {
            if (!debugCapture.rowHealth) {
                debugCapture.rowHealth = new Array(rowOffset + numDataRows);
            } else if (debugCapture.rowHealth.length < rowOffset + numDataRows) {
                debugCapture.rowHealth.length = rowOffset + numDataRows;
            }
        }

        const width = source.width;
        const imgData = source.data;

        for (let r = 0; r < numDataRows; r++) {
            const rowIndex = 2 + r;
            if (r % 5 === 0) await new Promise(res => setTimeout(res, 0));

            // 1. Read Metadata (CRC + Parity Bits)
            const startBlock = rowIndex * BLOCKS_PER_ROW;
            const metaStartBlock = startBlock + BINARY_DATA_BLOCKS_PER_ROW;
            // Decode Metadata (Hard decision for initial extract)
            const metaBytesRaw = decodeBytesFromBlocks(BINARY_ROW_META_BYTES, imgData, width, metaStartBlock);

            // Extract CRC32
            const storedCrc = ((metaBytesRaw[BINARY_ROW_PARITY_BYTES] << 24) | (metaBytesRaw[BINARY_ROW_PARITY_BYTES + 1] << 16) | (metaBytesRaw[BINARY_ROW_PARITY_BYTES + 2] << 8) | metaBytesRaw[BINARY_ROW_PARITY_BYTES + 3]) >>> 0;

            // Extract Soft LLRs for the Parity Bits (28 bytes = 224 bits)
            const metaLLRs = PxfDecoder.computeLdpcInputFromBlocks(BINARY_ROW_PARITY_BYTES, imgData, width, metaStartBlock);

            // 2. Generate LLRs for Data (19840 bits = 9920 2-bit pairs)
            // Each 8x8 block contains: 64 Y samples, 16 Cb samples (4x4), 16 Cr samples (4x4)
            // Total: 20 bytes per block (160 bits)
            const totalPairs = BINARY_ROW_DATA_CAPACITY * 4; // 9920 pairs
            const permutedLLRs = new Float32Array(LDPC_BINARY_K); // 19840 bits
            let llrIdx = 0;

            const rowBaseY = rowIndex * 8;

            // Process each block
            for (let blockIdx = 0; blockIdx < BINARY_DATA_BLOCKS_PER_ROW; blockIdx++) {
                const bx = (blockIdx % BLOCKS_PER_ROW) * 8;

                // Read all pixels in the block and convert to YCbCr points
                const yPoints: number[] = new Array(64).fill(0);
                const cbPoints: number[] = new Array(16).fill(0);
                const crPoints: number[] = new Array(16).fill(0);

                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        const [R, G, B] = PxfDecoder.getPixelVal(imgData, bx + px, rowBaseY + py, width);

                        // Convert RGB to YCbCr point space (without mu-law)
                        const point = decodeBinaryRGBToPoint(R, G, B);
                        const yIdx = py * 8 + px;
                        yPoints[yIdx] = point[0]; // Y

                        // For chroma, we need to average 2x2 blocks (4:2:0 subsampling)
                        const chromaY = py >>> 1;
                        const chromaX = px >>> 1;
                        const chromaIdx = chromaY * 4 + chromaX;

                        // Store chroma values (add part)
                        cbPoints[chromaIdx] += point[1] / 4.0; // Cb
                        crPoints[chromaIdx] += point[2] / 4.0; // Cr
                    }
                }

                // Now map points to discretized values [0..255] and lookup LLRs
                // First, Y channel (64 values = 128 bits)
                for (let i = 0; i < 64; i++) {
                    const point = yPoints[i];
                    // Map [-1, 1] to [0, 255]
                    const pixelValue = Math.max(0, Math.min(255, Math.round((point + 1.0) * 128)));
                    const llrs = LLR_LOOKUP_2BIT[pixelValue];
                    permutedLLRs[llrIdx++] = llrs[0];
                    permutedLLRs[llrIdx++] = llrs[1];
                }

                // Then Cb channel (16 values = 16 bits)
                for (let i = 0; i < 16; i++) {
                    const point = cbPoints[i];
                    const pixelValue = Math.max(0, Math.min(255, Math.round((point + 1.0) * 128)));
                    permutedLLRs[llrIdx++] = LLR_LOOKUP_1BIT_CHROMA[pixelValue];
                }

                // Finally Cr channel (16 values = 16 bits)
                for (let i = 0; i < 16; i++) {
                    const point = crPoints[i];
                    const pixelValue = Math.max(0, Math.min(255, Math.round((point + 1.0) * 128)));
                    permutedLLRs[llrIdx++] = LLR_LOOKUP_1BIT_CHROMA[pixelValue];
                }
            }

            // 3. De-permute at 2-bit pair level to match the sequential order used during LDPC encoding
            const permutation = generateBinaryPermutation(r);
            const dataLLRs = new Float32Array(LDPC_BINARY_K); // 19840 bits

            for (let pairIdx = 0; pairIdx < totalPairs; pairIdx++) {
                const sequentialPairIdx = permutation[pairIdx]; // Where this pair originally came from

                // Each pair has 2 bits, so 2 LLRs
                const permutedLLRIdx = pairIdx * 2;
                const sequentialLLRIdx = sequentialPairIdx * 2;

                // Copy the 2 LLRs from permuted position to sequential position
                dataLLRs[sequentialLLRIdx] = permutedLLRs[permutedLLRIdx];
                dataLLRs[sequentialLLRIdx + 1] = permutedLLRs[permutedLLRIdx + 1];
            }

            // 4. Construct Full Code Word LLRs [Data (19840) | Parity (224)]
            const fullLLRs = new Float32Array(LDPC_BINARY_N);
            fullLLRs.set(dataLLRs, 0);
            fullLLRs.set(metaLLRs, LDPC_BINARY_K);

            // 5. LDPC Decode (now with LLRs in correct sequential order)
            const decoded = binaryLdpc.decode(fullLLRs);

            // The decoded data is in SEQUENTIAL order (as it was when encoded)
            const rowBuffer = decoded.data;

            // 6. Verify Row CRC (CRC was computed on sequential data)
            const rowCrcOk = (crc32c(rowBuffer) >>> 0) === storedCrc;
            if (!rowCrcOk) {
                validChecksum = false;
            }

            const writeSize = Math.min(BINARY_ROW_DATA_CAPACITY, fileSize - r * BINARY_ROW_DATA_CAPACITY);
            data.set(rowBuffer.slice(0, writeSize), r * BINARY_ROW_DATA_CAPACITY);

            if (debugCapture) {
                const totalRowBits = writeSize * 8;
                const rowHealth = this.computeRowHealth(dataLLRs, rowBuffer, writeSize, rowCrcOk, decoded.corrected);
                debugCapture.rowHealth[rowOffset + r] = rowHealth;

                totalBits += totalRowBits;
                totalHealthyBits += Math.round((rowHealth / 100) * totalRowBits);
            }
        }

        return { data, validChecksum, rowsDecoded: numDataRows, totalBits, totalHealthyBits };
    }

    private static computeRowHealth(
        dataLLRs: Float32Array,
        decodedData: Uint8Array,
        byteLength: number,
        rowCrcOk: boolean,
        corrected: boolean
    ): number {
        if (!rowCrcOk || !corrected || byteLength === 0) return 0;

        let diffBits = 0;
        for (let i = 0; i < byteLength; i++) {
            let rawByte = 0;
            const bitBase = i * 8;
            rawByte |= (dataLLRs[bitBase] < 0 ? 1 : 0) << 7;
            rawByte |= (dataLLRs[bitBase + 1] < 0 ? 1 : 0) << 6;
            rawByte |= (dataLLRs[bitBase + 2] < 0 ? 1 : 0) << 5;
            rawByte |= (dataLLRs[bitBase + 3] < 0 ? 1 : 0) << 4;
            rawByte |= (dataLLRs[bitBase + 4] < 0 ? 1 : 0) << 3;
            rawByte |= (dataLLRs[bitBase + 5] < 0 ? 1 : 0) << 2;
            rawByte |= (dataLLRs[bitBase + 6] < 0 ? 1 : 0) << 1;
            rawByte |= (dataLLRs[bitBase + 7] < 0 ? 1 : 0);

            diffBits += BIT_COUNT_TABLE[rawByte ^ decodedData[i]];
        }

        const totalBits = byteLength * 8;
        return Math.max(0, 100 - (diffBits / totalBits) * 100);
    }
}

const BIT_COUNT_TABLE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let v = i;
        let c = 0;
        while (v) {
            v &= v - 1;
            c++;
        }
        table[i] = c;
    }
    return table;
})();
