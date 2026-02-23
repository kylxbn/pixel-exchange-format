// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { CHANNEL_MODE, BLOCK_SIZE } from '../constants';
import { LLR_LOOKUP_1BIT_LUMA, LLR_LOOKUP_2BIT } from './models/generic';
import { StreamingAudioDecoder } from './audio';
import { BinaryDecoder } from './binary';
import type { BinaryDecodeDebugCapture } from './binary';
import { HeaderDecoder } from './header';

export interface VisualizationMetadata {
    hopSize: number;
    firstAudioBlockIndex: number;
    sampleRate: number;
    blocksPerRow: number;
    totalAudioBlocks: number;
    version: number;
}

export interface AudioResult {
    type: 'audio';
    channels: Float32Array[];
    sampleRate: number;
    metadata: Record<string, string>;
    visualizationMetadata: VisualizationMetadata;
    sourceImageIndex: number;
    decoder: StreamingAudioDecoder;
}

export interface BlockStats {
    lumaScale: number;
    chromaScale: number;
    bandFactors: Float32Array;
    sbrData: Uint8Array | null;
}

export interface BinaryResult {
    type: 'binary';
    data: Uint8Array;
    metadata: Record<string, string>;
    visualizationMetadata: VisualizationMetadata;
    validChecksum: boolean;
}

export type { BinaryDecodeDebugCapture };
export type DecodeResult = AudioResult | BinaryResult;

export interface ImageSource {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    channelMode: number;
    visualizationMetadata: VisualizationMetadata;
    totalSamples: number; // Interpreted as File Size for binary
    sampleRate: number;
    metadata: Record<string, string>;
    randomBytes: Uint8Array;
    imageIndex: number;
    totalImages: number;
}

export interface AudioRowMetadata {
    scaleYA: number;
    scaleYB: number;
    scaleCAX: number;
    scaleCAY: number;
    scaleCBX: number;
    scaleCBY: number;
    bandFactorsA: Float32Array;
    bandFactorsB: Float32Array;
    sbrData: Uint8Array | null;
}

export interface RawImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export class PxfDecoder {
    public static load(imgData: RawImageData): ImageSource {
        return HeaderDecoder.parseHeader(imgData);
    }

    // Helpers
    public static getPixelVal(imageData: Uint8ClampedArray, x: number, y: number, width: number): [number, number, number] {
        if (x < 0 || x >= width || y < 0 || y >= Math.floor(imageData.length / (width * 4))) {
            return [0, 0, 0]; // Return black pixel for out-of-bounds
        }
        const offset = (y * width + x) * 4;

        return [
            imageData[offset],
            imageData[offset + 1],
            imageData[offset + 2],
        ];
    }

    /**
     * Computes Log-Likelihood Ratios (LLRs) for Gray Coded pixels.
     * Used for Soft-Decision LDPC Decoding.
     *
     * LLR = log( P(bit=0) / P(bit=1) )
     * Positive LLR -> Strong 0
     * Negative LLR -> Strong 1
     */
    public static computeBinaryLLRs(pixel: number): { llr0: number, llr1: number } {
        const p = Math.max(0, Math.min(255, pixel));

        const entry = LLR_LOOKUP_2BIT[Math.round(p)];
        return { llr0: entry[0], llr1: entry[1] };
    }

    /**
     * Computes LLRs for 1-bit coded pixels (Metadata Blocks).
     * Pixel 0 -> Strong 0
     * Pixel 255 -> Strong 1
     */
    public static computeLdpcInputFromBlocks(
        byteLength: number,
        imageData: Uint8ClampedArray,
        imageWidth: number,
        startBlockIndex: number
    ): Float32Array {
        const totalBits = byteLength * 8;
        const llrs = new Float32Array(totalBits);

        const blocksPerRow = imageWidth / BLOCK_SIZE;

        for (let bitIndex = 0; bitIndex < totalBits; bitIndex++) {
            const pixelIndexInStream = bitIndex;
            const blockIndex = startBlockIndex + (pixelIndexInStream >>> 6);
            const pixelInBlock = pixelIndexInStream & 63;
            const blockX = (blockIndex % blocksPerRow) * BLOCK_SIZE;
            const blockY = Math.floor(blockIndex / blocksPerRow) * BLOCK_SIZE;
            const x = blockX + (pixelInBlock & 7);
            const y = blockY + (pixelInBlock >>> 3);

            const pixelRGB = this.getPixelVal(imageData, x, y, imageWidth);
            const pixel = (pixelRGB[0] + pixelRGB[1] + pixelRGB[2]) / 3.0

            llrs[bitIndex] = LLR_LOOKUP_1BIT_LUMA[Math.round(pixel)];
        }
        return llrs;
    }

    public static async decode(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<DecodeResult> {
        if (sources.length === 0) throw new Error("No valid sources found");

        // Check for mixed audio/binary before processing
        const hasAudio = sources.some(s => s.channelMode !== CHANNEL_MODE.BINARY);
        const hasBinary = sources.some(s => s.channelMode === CHANNEL_MODE.BINARY);
        if (hasAudio && hasBinary) {
            throw new Error("Unable to decode images containing both audio and binary data.");
        }

        // Group sources by randomBytes to identify images that belong together
        const groups = new Map<string, ImageSource[]>();
        for (const source of sources) {
            const key = Array.from(source.randomBytes).join(',');
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(source);
        }

        // Find the largest group (most complete set of images)
        let largestGroup: ImageSource[] = [];
        for (const group of groups.values()) {
            if (group.length > largestGroup.length) {
                largestGroup = group;
            }
        }

        if (largestGroup.length === 0) {
            throw new Error("No valid image sources found");
        }

        // Sort the group by imageIndex
        largestGroup.sort((a, b) => a.imageIndex - b.imageIndex);

        // Validate that we have a complete sequence
        const totalImages = largestGroup[0].totalImages;
        if (largestGroup.length !== totalImages) {
            console.warn(`Incomplete image sequence: found ${largestGroup.length} of ${totalImages} images. Proceeding with available images.`);
        }

        // Check if Binary Mode (use first file)
        if (largestGroup[0].channelMode === CHANNEL_MODE.BINARY) {
            return await BinaryDecoder.decodeBinaryImages(largestGroup, debugCapture);
        }

        const decoder = new StreamingAudioDecoder(largestGroup);
        return decoder.decodeAll();
    }

    public static async decodeMetadataOnly(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<DecodeResult> {
        if (sources.length === 0) throw new Error("No valid sources found");

        // Check if Binary Mode (use first file) - binary still decodes fully
        if (sources[0].channelMode === CHANNEL_MODE.BINARY) {
            return await BinaryDecoder.decodeBinaryImages(sources, debugCapture);
        }

        // For audio: create decoder without calling decodeAll()
        const decoder = new StreamingAudioDecoder(sources);
        const primarySource = decoder.primarySource;

        return {
            type: 'audio',
            channels: [], // empty for metadata only
            sampleRate: decoder.sampleRate,
            metadata: primarySource.metadata,
            visualizationMetadata: decoder.visualizationMetadata,
            sourceImageIndex: sources.indexOf(primarySource),
            decoder
        };
    }
}
