// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { BLOCK_SIZE } from '../constants';
import { crc32c } from '../utils/crc32';
import {
    BINARY_STRIP_DATA_CAPACITY, BINARY_STRIP_HEIGHT, LDPC_BINARY_K, LDPC_BINARY_N,
    analyzeStrip, demodulateStrip, estimateNoise, generateBinaryScrambleMask, getBinaryLdpc,
} from '../utils/binaryModulation';
import { getBinaryPermutation } from '../utils/shuffle';
import type { BinaryDecodeDebugCapture, BinaryResult, ImageSource } from './types';

export class BinaryDecoder {
    public static async decodeBinaryImages(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<BinaryResult> {
        sources = [...sources].sort((a, b) => a.imageIndex - b.imageIndex);

        // Calculate total file size from all chunks
        let totalFileSize = 0;
        let totalRows = 0;
        for (const source of sources) {
            totalFileSize += source.totalSamples; // totalSamples contains chunk size for binary
            totalRows += Math.ceil(source.totalSamples / BINARY_STRIP_DATA_CAPACITY);
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
        const numStrips = Math.ceil(fileSize / BINARY_STRIP_DATA_CAPACITY);
        const data = new Uint8Array(fileSize);
        let validChecksum = true;
        let totalBits = 0;
        let totalHealthyBits = 0;

        if (debugCapture) {
            if (!debugCapture.rowHealth) {
                debugCapture.rowHealth = new Array(rowOffset + numStrips);
            } else if (debugCapture.rowHealth.length < rowOffset + numStrips) {
                debugCapture.rowHealth.length = rowOffset + numStrips;
            }
        }

        // 1. Read every strip's coefficients, then fit the noise model to the whole image
        const strips = [];
        for (let s = 0; s < numStrips; s++) {
            if (s % 8 === 0) await new Promise(res => setTimeout(res, 0));
            strips.push(analyzeStrip(source.data, 2 * BLOCK_SIZE + s * BINARY_STRIP_HEIGHT));
        }
        const noise = estimateNoise(strips);

        const ldpc = getBinaryLdpc();
        const permutation = getBinaryPermutation();

        for (let s = 0; s < numStrips; s++) {
            if (s % 2 === 0) await new Promise(res => setTimeout(res, 0));

            // 2. Soft-demodulate, de-interleave and un-whiten
            const received = demodulateStrip(strips[s], noise);
            const mask = generateBinaryScrambleMask(s);
            const llrs = new Float32Array(LDPC_BINARY_N);
            for (let i = 0; i < LDPC_BINARY_N; i++) {
                const position = permutation[i];
                const flip = (mask[position >>> 3] >> (7 - (position & 7))) & 1;
                llrs[position] = flip ? -received[i] : received[i];
            }

            // 3. LDPC decode, then check the CRC that travels inside the codeword
            const decoded = ldpc.decode(llrs);
            const payload = decoded.data.subarray(0, BINARY_STRIP_DATA_CAPACITY);
            const crcOffset = BINARY_STRIP_DATA_CAPACITY;
            const storedCrc = ((decoded.data[crcOffset] << 24) | (decoded.data[crcOffset + 1] << 16) | (decoded.data[crcOffset + 2] << 8) | decoded.data[crcOffset + 3]) >>> 0;
            const crcOk = (crc32c(payload) >>> 0) === storedCrc;
            if (!crcOk) {
                validChecksum = false;
            }

            const writeSize = Math.min(BINARY_STRIP_DATA_CAPACITY, fileSize - s * BINARY_STRIP_DATA_CAPACITY);
            data.set(payload.subarray(0, writeSize), s * BINARY_STRIP_DATA_CAPACITY);

            if (debugCapture) {
                const health = this.computeStripHealth(llrs, decoded.data, crcOk, decoded.corrected);
                debugCapture.rowHealth[rowOffset + s] = health;

                totalBits += writeSize * 8;
                totalHealthyBits += Math.round((health / 100) * writeSize * 8);
            }
        }

        return { data, validChecksum, rowsDecoded: numStrips, totalBits, totalHealthyBits };
    }

    /** Share of the message bits the channel delivered correctly before error correction. */
    private static computeStripHealth(llrs: Float32Array, decodedData: Uint8Array, crcOk: boolean, corrected: boolean): number {
        if (!crcOk || !corrected) return 0;

        let diffBits = 0;
        for (let i = 0; i < LDPC_BINARY_K; i++) {
            const received = llrs[i] < 0 ? 1 : 0;
            const actual = (decodedData[i >>> 3] >> (7 - (i & 7))) & 1;
            if (received !== actual) diffBits++;
        }

        return Math.max(0, 100 - (diffBits / LDPC_BINARY_K) * 100);
    }
}
