// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { CHANNEL_MODE, BLOCK_SIZE } from '../constants';
import { LLR_LOOKUP_1BIT_LUMA } from './models/generic';
import { StreamingAudioDecoder } from './audio';
import { BinaryDecoder } from './binary';
import { HeaderDecoder } from './header';
import type { BinaryDecodeDebugCapture, DecodeResult, ImageSource, RawImageData } from './types';

export type {
    AudioResult, AudioRowMetadata, BinaryDecodeDebugCapture, BinaryResult, BlockStats,
    DecodeResult, ImageSource, RawImageData, VisualizationMetadata
} from './types';


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

    /**
     * Picks the set of images that belong together (largest group sharing the
     * header's random salt) and returns them sorted by image index.
     */
    public static selectImageSet(sources: ImageSource[]): ImageSource[] {
        if (sources.length === 0) throw new Error("No valid sources found");

        const hasAudio = sources.some(s => s.channelMode !== CHANNEL_MODE.BINARY);
        const hasBinary = sources.some(s => s.channelMode === CHANNEL_MODE.BINARY);
        if (hasAudio && hasBinary) {
            throw new Error("Unable to decode images containing both audio and binary data.");
        }

        const groups = new Map<string, ImageSource[]>();
        for (const source of sources) {
            const key = Array.from(source.randomBytes).join(',');
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(source);
        }

        let largestGroup: ImageSource[] = [];
        for (const group of groups.values()) {
            if (group.length > largestGroup.length) {
                largestGroup = group;
            }
        }

        const imageSet = [...largestGroup].sort((a, b) => a.imageIndex - b.imageIndex);

        const totalImages = imageSet[0].totalImages;
        if (imageSet.length !== totalImages) {
            console.warn(`Incomplete image sequence: found ${imageSet.length} of ${totalImages} images. Proceeding with available images.`);
        }

        return imageSet;
    }

    public static async decode(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<DecodeResult> {
        const imageSet = PxfDecoder.selectImageSet(sources);

        if (imageSet[0].channelMode === CHANNEL_MODE.BINARY) {
            return await BinaryDecoder.decodeBinaryImages(imageSet, debugCapture);
        }

        const decoder = new StreamingAudioDecoder(imageSet);
        return decoder.decodeAll();
    }

    /**
     * Like decode(), but audio is not decoded: the returned result carries a
     * StreamingAudioDecoder for progressive playback. Binary still decodes fully.
     */
    public static async decodeMetadataOnly(sources: ImageSource[], debugCapture?: BinaryDecodeDebugCapture | null): Promise<DecodeResult> {
        const imageSet = PxfDecoder.selectImageSet(sources);

        if (imageSet[0].channelMode === CHANNEL_MODE.BINARY) {
            return await BinaryDecoder.decodeBinaryImages(imageSet, debugCapture);
        }

        const decoder = new StreamingAudioDecoder(imageSet);
        const primarySource = decoder.primarySource;

        return {
            type: 'audio',
            channels: [],
            sampleRate: decoder.sampleRate,
            metadata: primarySource.metadata,
            visualizationMetadata: decoder.visualizationMetadata,
            sourceImageIndex: sources.indexOf(primarySource),
            decoder
        };
    }
}
