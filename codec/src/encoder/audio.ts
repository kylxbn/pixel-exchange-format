// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    encodeBytesToBlocks, numberToBytes,
    getSineWindow,
    logEncode,
} from '../utils/audioUtils';
import { floatToHalf } from '../utils/ieee';
import { getMdctWhiteningProfile } from '../utils/mdctWhitening';
import { createRNG } from '../utils/rng';
import {
    BLOCK_SIZE, CHANNEL_MODE,
    IMAGE_WIDTH, BLOCKS_PER_ROW, DATA_BLOCKS_PER_ROW,
    FORMAT_VERSION, ROW_META_PAYLOAD_BYTES,
    ROW_META_XOR_SEED_BASE,
    MDCT_HOP_SIZE, MDCT_WINDOW_SIZE,
} from '../constants';
import { rowMetaLdpc } from '../constants';
import { ChunkingUtils } from './chunking';
import { HeaderEncoder } from './header';
import { TextRenderer } from './text';
import { processRow } from './audioMath';
import type { EncodeRowBuffers } from './audioMath';

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

export class AudioEncoder {
    public static calculateDimensions(totalSamples: number): { width: number; height: number } {
        const hopSize = MDCT_HOP_SIZE; // 128
        const totalAudioBlocks = Math.ceil(totalSamples / hopSize);
        const firstAudioBlockIndex = 2 * BLOCKS_PER_ROW;
        const totalImageBlocksForAudio = totalAudioBlocks; // 1:1 mapping
        const numImageRows = Math.ceil(totalImageBlocksForAudio / DATA_BLOCKS_PER_ROW);
        const totalDataAndMetaBlocks = numImageRows * BLOCKS_PER_ROW;
        const totalBlocks = firstAudioBlockIndex + totalDataAndMetaBlocks;
        const numBlockRows = Math.ceil(totalBlocks / BLOCKS_PER_ROW);
        const height = numBlockRows * BLOCK_SIZE;
        return { width: IMAGE_WIDTH, height };
    }

    public static async encodeAudio(
        channels: Float32Array[],
        sampleRate: number,
        metadata: Record<string, string>,
        options: { maxHeight?: number } = {},
        onProgress?: (p: number) => void
    ): Promise<EncodedImageResult[]> {
        const results: EncodedImageResult[] = [];
        
        // Generate random number using RNG
        const randomSeed = Math.floor(Math.random() * 2**32);
        const randomGenerator = createRNG(randomSeed);
        const randomBytes = new Uint8Array(numberToBytes(randomGenerator.next32(), 4));

        if (channels.length === 1) {
            // Split mono audio into chunks
            const chunks = ChunkingUtils.splitAudioForMultiImage(channels, options.maxHeight);
            for (let i = 0; i < chunks.length; i++) {
                const progressCallback = onProgress ? (p: number) => onProgress((i + p / 100) / chunks.length * 100) : undefined;
                results.push(await this.encodeChannel(chunks[i][0], sampleRate, metadata, CHANNEL_MODE.MONO, randomBytes, i + 1, chunks.length, channels[0].length, progressCallback));
            }
        } else {
            const left = channels[0];
            const right = channels[1];
            const mid = new Float32Array(left.length);
            const side = new Float32Array(left.length);

            // M/S Matrixing
            for (let i = 0; i < left.length; i++) {
                mid[i] = (left[i] + right[i]) * 0.5;
                side[i] = (left[i] - right[i]) * 0.5;
            }

            // Split stereo channels into chunks
            const midChunks = ChunkingUtils.splitAudioForMultiImage([mid], options.maxHeight);
            const sideChunks = ChunkingUtils.splitAudioForMultiImage([side], options.maxHeight);

            // Ensure both have the same number of chunks
            const numChunks = Math.max(midChunks.length, sideChunks.length);
            const totalImages = numChunks * 2; // mid1, side1, mid2, side2, ...

            for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
                // Encode mid channel (odd image indices: 1, 3, 5, ...)
                const midImageIndex = chunkIdx * 2 + 1;
                const progressCallbackMid = onProgress ? (p: number) => onProgress((midImageIndex - 1 + p / 100) / totalImages * 100) : undefined;

                if (chunkIdx < midChunks.length) {
                    results.push(await this.encodeChannel(midChunks[chunkIdx][0], sampleRate, metadata, CHANNEL_MODE.STEREO_MID, randomBytes, midImageIndex, totalImages, channels[0].length, progressCallbackMid));
                }

                // Encode side channel (even image indices: 2, 4, 6, ...)
                const sideImageIndex = chunkIdx * 2 + 2;
                const progressCallbackSide = onProgress ? (p: number) => onProgress((sideImageIndex - 1 + p / 100) / totalImages * 100) : undefined;

                if (chunkIdx < sideChunks.length) {
                    results.push(await this.encodeChannel(sideChunks[chunkIdx][0], sampleRate, metadata, CHANNEL_MODE.STEREO_SIDE, randomBytes, sideImageIndex, totalImages, channels[0].length, progressCallbackSide));
                }
            }
        }

        return results;
    }

    public static async encodeChannel(
        channelData: Float32Array,
        sampleRate: number,
        metadata: Record<string, string>,
        channelMode: number,
        randomBytes: Uint8Array,
        imageIndex: number,
        totalImages: number,
        totalSamples: number,
        onProgress?: (p: number) => void
    ): Promise<EncodedImageResult> {
        const dims = this.calculateDimensions(channelData.length);
        const buffer = new Uint8ClampedArray(dims.width * dims.height * 4);
        const imageData: SimpleImageData = { data: buffer, width: dims.width, height: dims.height };

        // Fill black
        buffer.fill(0);
        for (let i = 3; i < buffer.length; i += 4) buffer[i] = 255;

        // --- Row 0: Header ---
        HeaderEncoder.writeHeader(imageData, sampleRate, channelData.length, channelMode, metadata, randomBytes, imageIndex, totalImages);

        // --- Row 1: Text Info ---
        this.drawInfoText(imageData, channelData.length, sampleRate, channelMode, metadata, 1, imageIndex, totalImages, totalSamples);

        // --- Row 2+: Audio Encoding Pipeline ---
        const hopSize = MDCT_HOP_SIZE; // 128 (with SBR)
        const windowSize = MDCT_WINDOW_SIZE; // 256
        const mdctWindow = getSineWindow(windowSize);

        const totalAudioBlocks = Math.ceil(channelData.length / hopSize);
        const paddedLength = (totalAudioBlocks + 1) * hopSize * 2;
        const paddedAudio = new Float32Array(paddedLength);
        paddedAudio.set(channelData);

        const totalImageBlocksForAudio = totalAudioBlocks;
        const numImageRows = Math.ceil(totalImageBlocksForAudio / DATA_BLOCKS_PER_ROW);
        const firstAudioBlockIndex = 2 * BLOCKS_PER_ROW;
        const whiteningProfile = getMdctWhiteningProfile(sampleRate);

        // Reusable work buffers to avoid allocation in loop
        const buffers: EncodeRowBuffers = {
            winFrame: new Float32Array(windowSize),
            mdctCoeffs: new Float32Array(hopSize), // 128 bins total
            // Work buffers for 8x8 blocks
            dctY: new Float32Array(64),
            dctCb: new Float32Array(64),
            dctCr: new Float32Array(64),
            spatialY: new Float32Array(64),
            spatialCb: new Float32Array(64),
            spatialCr: new Float32Array(64),
            temp: new Float32Array(64)
        };

        for (let rowIndex = 0; rowIndex < numImageRows; rowIndex++) {
            if (rowIndex % 5 === 0) {
                if (onProgress) onProgress((rowIndex / numImageRows) * 100);
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const firstImageBlockInRow = rowIndex * DATA_BLOCKS_PER_ROW;
            const rowDataCount = Math.min(DATA_BLOCKS_PER_ROW, totalImageBlocksForAudio - firstImageBlockInRow);

            processRow(
                rowIndex, rowDataCount, firstImageBlockInRow, firstAudioBlockIndex, totalAudioBlocks,
                paddedAudio,
                imageData, hopSize, windowSize, mdctWindow, sampleRate,
                whiteningProfile,
                buffers,
                AudioEncoder.encodeRowMetadata,
            );
        }

        if (onProgress) onProgress(100);

        const suffix = totalImages > 1 ? `_${imageIndex}_${totalImages}.png` : '.png';

        return { data: buffer, width: dims.width, height: dims.height, name: (metadata.fn || 'audio') + suffix };
    }

    public static drawInfoText(
        imageData: SimpleImageData,
        len: number,
        rate: number,
        chMode: number,
        metadata: Record<string, string>,
        rowIndex: number,
        imageIndex: number,
        totalImages: number,
        totalSamples: number
    ): void {
        const chunkDurationSec = len / rate;
        const totalDurationSec = totalSamples / rate;
        const chunkMins = Math.floor(chunkDurationSec / 60);
        const chunkSecs = Math.floor(chunkDurationSec % 60);
        const totalMins = Math.floor(totalDurationSec / 60);
        const totalSecs = Math.floor(totalDurationSec % 60);
        const durStr = `${chunkMins.toString().padStart(2, '0')}:${chunkSecs.toString().padStart(2, '0')} (${totalMins.toString().padStart(2, '0')}:${totalSecs.toString().padStart(2, '0')})`;
        let chanStr = "MONO";
        if (chMode === CHANNEL_MODE.STEREO_MID) chanStr = "STEREO MID";
        if (chMode === CHANNEL_MODE.STEREO_SIDE) chanStr = "STEREO SIDE";
        const modeStr = "DCT+SBR";

        const filename = metadata.fn || 'UNTITLED';
        const comment = metadata.comment || '';

        let text = `PXF V${FORMAT_VERSION} AUDIO   ${rate}HZ ${chanStr}   ${durStr}   ${modeStr}   IMG ${imageIndex}/${totalImages}   ${filename}`;
        if (comment) {
            text += `   ${comment}`;
        }
        TextRenderer.drawTextRow(TextRenderer.toDisplayText(text), imageData.data, IMAGE_WIDTH, rowIndex);
    }

    public static encodeRowMetadata(
        rowIndex: number,
        scaleYA: number, scaleYB: number, scaleCAX: number, scaleCAY: number, scaleCBX: number, scaleCBY: number,
        bandFactorsA: Float32Array, bandFactorsB: Float32Array,
        sbrData: Uint8Array,
        imageData: SimpleImageData, blockIndex: number
    ): void {
        const payload = new Uint8Array(ROW_META_PAYLOAD_BYTES); // 28 bytes

        // 0-7: SBR Data
        payload.set(sbrData, 0);

        // 8-19: Half Floats (Spatial Scaling Stats)
        const p1 = floatToHalf(scaleYA);
        const p2 = floatToHalf(scaleYB);
        const p3 = floatToHalf(scaleCAX);
        const p4 = floatToHalf(scaleCAY);
        const p5 = floatToHalf(scaleCBX);
        const p6 = floatToHalf(scaleCBY);

        const set16 = (i: number, val: number) => {
            payload[i] = val & 0xFF;
            payload[i + 1] = (val >> 8) & 0xFF;
        };

        set16(8, p1);
        set16(10, p2);
        set16(12, p3);
        set16(14, p4);
        set16(16, p5);
        set16(18, p6);

        // 20-27: Band Factors (logarithmic encoding)
        for (let i = 0; i < 4; i++) payload[20 + i] = logEncode(bandFactorsA[i]);
        for (let i = 0; i < 4; i++) payload[24 + i] = logEncode(bandFactorsB[i]);

        // LDPC Encode (28 bytes -> 32 bytes)
        const ecBlock = rowMetaLdpc.encode(payload);

        // XOR Mask AFTER LDPC encoding, BEFORE writing to pixels (for whitening)
        // Use row-specific seed for deterministic but unique per-row whitening
        const rowMaskGen = createRNG(ROW_META_XOR_SEED_BASE + rowIndex);
        for (let i = 0; i < ecBlock.length; i++) {
            ecBlock[i] ^= rowMaskGen.nextByte();
            ecBlock[i] ^= rowMaskGen.nextByte();
        }

        // Write to 4 blocks
        encodeBytesToBlocks(ecBlock, imageData.data, IMAGE_WIDTH, blockIndex);
    }
}
