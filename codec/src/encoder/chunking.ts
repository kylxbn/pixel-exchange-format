// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { MDCT_HOP_SIZE, BLOCK_SIZE, BLOCKS_PER_ROW, BINARY_ROW_DATA_CAPACITY, DATA_BLOCKS_PER_ROW } from '../constants';

export class ChunkingUtils {
    public static splitAudioForMultiImage(
        channels: Float32Array[],
        maxHeight: number = 4096
    ): Float32Array[][] {
        const maxSamplesPerImage = this.calculateMaxSamplesPerImage(maxHeight);
        const totalSamples = channels[0].length;
        const hopSize = MDCT_HOP_SIZE;

        // Ensure we split at hop boundaries to maintain window continuity
        const maxSamplesPerImageAligned = Math.floor(maxSamplesPerImage / hopSize) * hopSize;

        const chunks: Float32Array[][] = [];
        let currentSample = 0;

        while (currentSample < totalSamples) {
            const remainingSamples = totalSamples - currentSample;
            const chunkSize = Math.min(maxSamplesPerImageAligned, remainingSamples);

            const chunkChannels: Float32Array[] = [];
            for (const channel of channels) {
                chunkChannels.push(channel.slice(currentSample, currentSample + chunkSize));
            }
            chunks.push(chunkChannels);

            currentSample += chunkSize;
        }

        return chunks;
    }

    public static splitBinaryForMultiImage(
        data: Uint8Array,
        maxHeight: number = 4096
    ): Uint8Array[] {
        const maxBytesPerImage = this.calculateMaxBinaryBytesPerImage(maxHeight);
        const totalBytes = data.length;
        const numImages = Math.ceil(totalBytes / maxBytesPerImage);

        const chunks: Uint8Array[] = [];

        for (let imgIdx = 0; imgIdx < numImages; imgIdx++) {
            const startByte = imgIdx * maxBytesPerImage;
            const endByte = Math.min(startByte + maxBytesPerImage, totalBytes);
            chunks.push(data.slice(startByte, endByte));
        }

        return chunks;
    }

    public static calculateMaxSamplesPerImage(maxHeight: number = 4096): number {
        const blockSize = BLOCK_SIZE;
        const blocksPerRow = BLOCKS_PER_ROW;
        const dataBlocksPerRow = DATA_BLOCKS_PER_ROW;

        const maxBlockRows = Math.floor(maxHeight / blockSize);
        const maxTotalBlocks = maxBlockRows * blocksPerRow;
        const firstAudioBlockIndex = 2 * blocksPerRow;
        const maxAudioBlocks = maxTotalBlocks - firstAudioBlockIndex;
        const maxImageRows = Math.floor(maxAudioBlocks / blocksPerRow);
        const maxTotalImageBlocks = maxImageRows * dataBlocksPerRow;
        const hopSize = MDCT_HOP_SIZE;
        return maxTotalImageBlocks * hopSize;
    }

    
    public static calculateMaxBinaryBytesPerImage(maxHeight: number = 4096): number {
        const blockSize = BLOCK_SIZE;
        const maxBlockRows = Math.floor(maxHeight / blockSize);
        const maxDataRows = maxBlockRows - 2; // Subtract header and text rows
        return maxDataRows * BINARY_ROW_DATA_CAPACITY;
    }
}
