// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { getSineWindow, logDecode } from '../utils/audioUtils';
import { halfToFloat } from '../utils/ieee';
import { createRNG } from '../utils/rng';
import { getMdctWhiteningProfile } from '../utils/mdctWhitening';
import type { MdctWhiteningProfile } from '../utils/mdctWhitening';
import {
    CHANNEL_MODE,
    BLOCKS_PER_ROW, DATA_BLOCKS_PER_ROW,
    SUBGROUP_A_SIZE, SUBGROUP_X_SIZE,
    ROW_META_TOTAL_BYTES, ROW_META_XOR_SEED_BASE,
    MDCT_HOP_SIZE,
    SILENCE_THRESHOLD,
    BLOCK_SIZE,
} from '../constants';
import { rowMetaLdpc } from '../constants';
import { decodeRGBToPoint } from '../utils/obb';
import { PxfDecoder } from '.';
import { decodeBlock } from './audioMath';
import type { DecodeBlockBuffers } from './audioMath';

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



export class StreamingAudioDecoder {
    sources: ImageSource[];
    visualizationMetadata: VisualizationMetadata;
    primarySource: ImageSource;

    private currentAudioBlock: number = 0;
    private overlapL: Float32Array;
    private overlapR: Float32Array;

    private windowSize: number;
    private mdctWindow: Float32Array;

    private rowMetaCache: Map<string, AudioRowMetadata> = new Map();
    private whiteningProfileBySampleRate: Map<number, MdctWhiteningProfile> = new Map();

    private buffers: DecodeBlockBuffers & {
        decodedWindow: Float32Array;
        coeffs: Float32Array;
    };

    /**
     * Creates a streaming audio decoder for PXF audio data.
     * Handles mono, stereo (mid/side), and multi-part audio sources.
     * Validates source compatibility and initializes decoding buffers.
     *
     * @param sources - Array of image sources containing encoded audio data
     * @throws {Error} If sources are incompatible (mixed audio/binary, invalid stereo pairs, etc.)
     */
    public constructor(sources: ImageSource[]) {
        this.sources = sources;
        const mono = sources.find(s => s.channelMode === CHANNEL_MODE.MONO);
        const mid = sources.find(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        const side = sources.find(s => s.channelMode === CHANNEL_MODE.STEREO_SIDE)

        this.primarySource = mono || mid || sources[0];

        if (this.primarySource.channelMode === CHANNEL_MODE.STEREO_SIDE) {
            throw new Error("Unable to decode side channel only. Either decode mid channel only, or both mid and side channels.");
        }

        if (mid && side) {
            // For stereo, validate that we have proper pairs of mid/side channels
            const allMids = sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
            const allSides = sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_SIDE);

            // First check random bytes match for any mid/side pairs (for backward compatibility with existing tests)
            for (const m of allMids) {
                for (const s of allSides) {
                    if ((m.imageIndex % 2 === 1 && s.imageIndex === m.imageIndex + 1) ||
                        (s.imageIndex % 2 === 1 && m.imageIndex === s.imageIndex + 1)) {
                        // Check random bytes match
                        if (!m.randomBytes || !s.randomBytes ||
                            m.randomBytes.length !== s.randomBytes.length ||
                            !m.randomBytes.every((v, i) => v === s.randomBytes[i])) {
                            throw new Error("Mid and side channel data do not belong together (random bytes mismatch).");
                        }
                        // Check totalSamples match
                        if (m.totalSamples !== s.totalSamples) {
                            throw new Error("Mid and side channel data do not belong together (sample count mismatch).");
                        }
                    }
                }
            }

            // Check that totalImages is even (since we have mid/side pairs)
            const expectedTotalImages = allMids[0]?.totalImages || allSides[0]?.totalImages || 0;
            if (expectedTotalImages % 2 !== 0) {
                throw new Error("Stereo audio must have an even number of images (mid/side pairs).");
            }

            // Validate all mid channels have odd indices and all side channels have even indices
            for (const m of allMids) {
                if (m.imageIndex % 2 === 0 || m.imageIndex < 1 || m.imageIndex > expectedTotalImages) {
                    throw new Error(`Invalid mid channel image index: ${m.imageIndex} (expected odd number 1-${expectedTotalImages}).`);
                }
                if (m.totalImages !== expectedTotalImages) {
                    throw new Error(`Mid channel totalImages mismatch: ${m.totalImages} vs ${expectedTotalImages}.`);
                }
            }
            for (const s of allSides) {
                if (s.imageIndex % 2 !== 0 || s.imageIndex < 1 || s.imageIndex > expectedTotalImages) {
                    throw new Error(`Invalid side channel image index: ${s.imageIndex} (expected even number 1-${expectedTotalImages}).`);
                }
                if (s.totalImages !== expectedTotalImages) {
                    throw new Error(`Side channel totalImages mismatch: ${s.totalImages} vs ${expectedTotalImages}.`);
                }
            }


        }

        // For multi-image audio, calculate total samples across all images
        let totalSamples = 0;
        if (this.primarySource.channelMode !== CHANNEL_MODE.BINARY) {
            // For stereo, only count mid channel samples (don't double-count mid+side)
            // For mono, sum all sources
            if (this.primarySource.channelMode === CHANNEL_MODE.STEREO_MID) {
                const midSrcs = sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
                for (const src of midSrcs) {
                    totalSamples += src.totalSamples;
                }
            } else {
                // Mono or other modes: sum all sources
                for (const src of sources) {
                    totalSamples += src.totalSamples;
                }
            }
        } else {
            // For binary, totalSamples is the chunk size for the current image
            totalSamples = this.primarySource.totalSamples;
        }

        // Update visualizationMetadata with correct totalAudioBlocks
        this.visualizationMetadata = {
            ...this.primarySource.visualizationMetadata,
            totalAudioBlocks: Math.ceil(totalSamples / this.primarySource.visualizationMetadata.hopSize)
        };

        this.windowSize = this.visualizationMetadata.hopSize * 2;
        this.mdctWindow = getSineWindow(this.windowSize);

        this.overlapL = new Float32Array(this.visualizationMetadata.hopSize);
        this.overlapR = new Float32Array(this.visualizationMetadata.hopSize);

        this.buffers = {
            decodedWindow: new Float32Array(this.windowSize),
            coeffs: new Float32Array(MDCT_HOP_SIZE), // 128 with SBR
            spatialY: new Float32Array(64),
            spatialCb: new Float32Array(64),
            spatialCr: new Float32Array(64),
            dctY: new Float32Array(64),
            dctCb: new Float32Array(64),
            dctCr: new Float32Array(64),
            temp: new Float32Array(64)
        };

        // Precompute whitening for the dominant decode sample rate once.
        this.whiteningProfileBySampleRate.set(
            this.primarySource.sampleRate,
            getMdctWhiteningProfile(this.primarySource.sampleRate)
        );
    }

    get sampleRate() {
        return this.primarySource.sampleRate;
    }

    get totalSamples(): number {
        if (this.primarySource.channelMode !== CHANNEL_MODE.BINARY) {
            // For stereo, only count mid channel samples (don't double-count mid+side)
            // For mono, sum all sources
            if (this.primarySource.channelMode === CHANNEL_MODE.STEREO_MID) {
                const midSrcs = this.sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
                return midSrcs.reduce((sum, src) => sum + src.totalSamples, 0);
            } else {
                // Mono: sum all sources
                return this.sources.reduce((sum, src) => sum + src.totalSamples, 0);
            }
        } else {
            // For binary, totalSamples is the chunk size for the current image
            return this.primarySource.totalSamples;
        }
    }

    get duration() {
        return this.totalSamples / this.sampleRate;
    }

    /**
     * Seeks to a specific sample position in the decoded audio stream.
     * Resets overlap buffers and advances to the target block position.
     *
     * @param sampleIndex - The sample index to seek to (0-based)
     */
    seek(sampleIndex: number) {
        const targetBlock = Math.floor(sampleIndex / this.visualizationMetadata.hopSize);
        this.currentAudioBlock = Math.max(0, targetBlock - 1);
        this.overlapL.fill(0);
        this.overlapR.fill(0);
        if (targetBlock > 0) {
            this.decodeNextBlocks(1);
        }
    }

    /**
     * Decodes audio row metadata from LDPC-protected pixel data.
     * Extracts scaling factors, band factors, and SBR parameters for the row.
     *
     * @param data - Image pixel data as RGBA bytes
     * @param width - Width of the image in pixels
     * @param blockIndex - Absolute index of the metadata block to decode
     * @returns {AudioRowMetadata} Decoded metadata including scaling factors and SBR data
     */
    public static decodeRowMetadata(data: Uint8ClampedArray, width: number, blockIndex: number): AudioRowMetadata {
        // Calculate row index from block index
        // metaBlockAbsIdx = (absRow * BLOCKS_PER_ROW) + DATA_BLOCKS_PER_ROW
        // absRow = 2 + rowInAudioArea
        const absRow = Math.floor((blockIndex - DATA_BLOCKS_PER_ROW) / BLOCKS_PER_ROW);
        const rowInAudioArea = absRow - 2;

        // Read LLRs from pixels using existing function
        const llrs = PxfDecoder.computeLdpcInputFromBlocks(ROW_META_TOTAL_BYTES, data, width, blockIndex);

        // Apply whitening by flipping LLR signs (equivalent to XOR on bits)
        // Match encoder: each byte is XORed with TWO PRNG bytes
        const rowMaskGen = createRNG(ROW_META_XOR_SEED_BASE + rowInAudioArea);
        for (let byteIdx = 0; byteIdx < ROW_META_TOTAL_BYTES; byteIdx++) {
            // Get two mask bytes and XOR them together (matching encoder)
            const mask1 = rowMaskGen.nextByte();
            const mask2 = rowMaskGen.nextByte();
            const combinedMask = mask1 ^ mask2;

            // For each bit in this byte, flip LLR sign if mask bit is 1
            for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
                const maskBit = (combinedMask >>> (7 - bitIdx)) & 1;
                if (maskBit === 1) {
                    llrs[byteIdx * 8 + bitIdx] = -llrs[byteIdx * 8 + bitIdx];
                }
            }
        }

        // LDPC Decode
        const decoded = rowMetaLdpc.decode(llrs);
        if (decoded.corrected == false) {
            // Return default/fallback metadata
            return {
                scaleYA: 1.0, scaleYB: 1.0, scaleCAX: 1.0, scaleCAY: 1.0, scaleCBX: 1.0, scaleCBY: 1.0,
                bandFactorsA: new Float32Array([1.0, 1.0, 1.0, 1.0]),
                bandFactorsB: new Float32Array([1.0, 1.0, 1.0, 1.0]),
                sbrData: null,
            };
        }
        const corrected = decoded.data; // 28 bytes

        // 0-7: SBR Data
        const sbrData = corrected.slice(0, 8);

        // 8-19: Half Floats (Spatial Scaling Stats)
        const p1 = (corrected[9] << 8) | corrected[8];
        const p2 = (corrected[11] << 8) | corrected[10];
        const p3 = (corrected[13] << 8) | corrected[12];
        const p4 = (corrected[15] << 8) | corrected[14];
        const p5 = (corrected[17] << 8) | corrected[16];
        const p6 = (corrected[19] << 8) | corrected[18];

        // 20-27: Band Factors (log encoding)
        const factorsA = new Float32Array(4);
        const factorsB = new Float32Array(4);
        for (let i = 0; i < 4; i++) factorsA[i] = logDecode(corrected[20 + i]);
        for (let i = 0; i < 4; i++) factorsB[i] = logDecode(corrected[24 + i]);

        // Validate decoded values are finite and not NaN
        const scales = [halfToFloat(p1), halfToFloat(p2), halfToFloat(p3), halfToFloat(p4), halfToFloat(p5), halfToFloat(p6)];

        // Compensate for chroma attenuation by scanning the row's chroma values
        let maxChromaAX = 0, maxChromaAY = 0, maxChromaBX = 0, maxChromaBY = 0;
        const dataStartBlock = absRow * BLOCKS_PER_ROW;
        const dataEndBlock = dataStartBlock + DATA_BLOCKS_PER_ROW;
        for (let blockIdx = dataStartBlock; blockIdx < dataEndBlock; blockIdx++) {
            const bx = (blockIdx % BLOCKS_PER_ROW) * BLOCK_SIZE;
            const by = Math.floor(blockIdx / BLOCKS_PER_ROW) * BLOCK_SIZE;
            const colInRow = blockIdx - dataStartBlock;
            const isA = colInRow < SUBGROUP_A_SIZE;
            const isX = (colInRow % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;

            let localMax = 0;
            // Scan chroma values in the block (average each 2x2 group)
            for (let yy = 0; yy < 8; yy += 2) {
                for (let xx = 0; xx < 8; xx += 2) {
                    let sumCb = 0, sumCr = 0;
                    for (let dy = 0; dy < 2; dy++) {
                        for (let dx = 0; dx < 2; dx++) {
                            const x = bx + xx + dx;
                            const y = by + yy + dy;
                            const off = (y * width + x) * 4;
                            const [, cb, cr] = decodeRGBToPoint(data[off], data[off + 1], data[off + 2]);
                            sumCb += cb;
                            sumCr += cr;
                        }
                    }
                    const avgCb = sumCb / 4;
                    const avgCr = sumCr / 4;
                    localMax = Math.max(localMax, Math.abs(avgCb), Math.abs(avgCr));
                }
            }

            // Accumulate max for the subgroup
            if (isA) {
                if (isX) {
                    maxChromaAX = Math.max(maxChromaAX, localMax);
                } else {
                    maxChromaAY = Math.max(maxChromaAY, localMax);
                }
            } else {
                if (isX) {
                    maxChromaBX = Math.max(maxChromaBX, localMax);
                } else {
                    maxChromaBY = Math.max(maxChromaBY, localMax);
                }
            }
        }

        const allBandFactors = [...factorsA, ...factorsB];

        if (scales.some(s => !isFinite(s)) || allBandFactors.some(f => !isFinite(f))) {
            // Return default/fallback metadata
            return {
                scaleYA: 1.0, scaleYB: 1.0, scaleCAX: 1.0, scaleCAY: 1.0, scaleCBX: 1.0, scaleCBY: 1.0,
                bandFactorsA: new Float32Array([1.0, 1.0, 1.0, 1.0]),
                bandFactorsB: new Float32Array([1.0, 1.0, 1.0, 1.0]),
                sbrData: null,
            };
        }

        return {
            scaleYA: scales[0],
            scaleYB: scales[1],
            scaleCAX: scales[2] * maxChromaAX,
            scaleCAY: scales[3] * maxChromaAY,
            scaleCBX: scales[4] * maxChromaBX,
            scaleCBY: scales[5] * maxChromaBY,
            bandFactorsA: factorsA,
            bandFactorsB: factorsB,
            sbrData: sbrData
        };
    }

    /**
     * Retrieves cached row metadata or decodes it if not cached.
     * @private
     * @param src - The image source containing the metadata
     * @param metaBlockAbsIdx - Absolute index of the metadata block
     * @returns {AudioRowMetadata} The cached or newly decoded metadata
     */
    private getCachedRowMetadata(src: ImageSource, metaBlockAbsIdx: number) {
        const key = `${src.imageIndex}:${metaBlockAbsIdx}`;

        if (this.rowMetaCache.has(key)) {
            return this.rowMetaCache.get(key)!;
        }

        const data = StreamingAudioDecoder.decodeRowMetadata(src.data, src.width, metaBlockAbsIdx);
        this.rowMetaCache.set(key, data);
        return data;
    }

    private getWhiteningProfile(sampleRate: number): MdctWhiteningProfile {
        let profile = this.whiteningProfileBySampleRate.get(sampleRate);
        if (!profile) {
            profile = getMdctWhiteningProfile(sampleRate);
            this.whiteningProfileBySampleRate.set(sampleRate, profile);
        }
        return profile;
    }

    /**
     * Gets visualization statistics for a specific audio block.
     * Used for displaying compression artifacts and audio characteristics.
     *
     * @param audioBlockIdx - Global audio block index (0-based)
     * @returns {BlockStats | null} Block statistics or null if out of bounds
     */
    getStatsAtBlock(audioBlockIdx: number): BlockStats | null {
        if (audioBlockIdx >= this.visualizationMetadata.totalAudioBlocks) return null;

        // For multi-part stereo, find the mid source that contains this block
        const midSrcs = this.sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        let src = this.primarySource;
        let localBlockIdx = audioBlockIdx;

        if (midSrcs.length > 1) {
            // Multi-part stereo: find which mid source contains this global block
            let accumulatedBlocks = 0;
            const sortedMids = [...midSrcs].sort((a, b) => a.imageIndex - b.imageIndex);

            for (const mid of sortedMids) {
                const blocksInThisPart = Math.ceil(mid.totalSamples / this.visualizationMetadata.hopSize);

                if (audioBlockIdx < accumulatedBlocks + blocksInThisPart) {
                    src = mid;
                    localBlockIdx = audioBlockIdx - accumulatedBlocks;
                    break;
                }

                accumulatedBlocks += blocksInThisPart;
            }
        }

        const imgBlockIdxBase = localBlockIdx;
        const rowInAudioArea = Math.floor(imgBlockIdxBase / DATA_BLOCKS_PER_ROW);
        const colInAudioArea = imgBlockIdxBase % DATA_BLOCKS_PER_ROW;
        const absRow = 2 + rowInAudioArea;
        // Point to the metadata blocks (last 4 blocks)
        const metaBlockAbsIdx = (absRow * BLOCKS_PER_ROW) + DATA_BLOCKS_PER_ROW;

        // Fetch Metadata (Cached)
        const { scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY, bandFactorsA, bandFactorsB, sbrData } = this.getCachedRowMetadata(src, metaBlockAbsIdx);

        const isSubgroupA = colInAudioArea < SUBGROUP_A_SIZE;
        const isSubgroupX = (colInAudioArea % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;
        const lumaScale = isSubgroupA ? scaleYA : scaleYB;
        const chromaScale = isSubgroupA
            ? (isSubgroupX ? scaleCAX : scaleCAY)
            : (isSubgroupX ? scaleCBX : scaleCBY);
        const bandFactors = isSubgroupA ? bandFactorsA : bandFactorsB;

        const displayLuma = (lumaScale > SILENCE_THRESHOLD) ? 1.0 / lumaScale : 0;
        const displayChroma = (chromaScale > SILENCE_THRESHOLD) ? 1.0 / chromaScale : 0;

        return { lumaScale: displayLuma, chromaScale: displayChroma, bandFactors, sbrData };
    }

    /**
     * Decodes a chunk of audio for the specified duration.
     * Useful for streaming playback without decoding the entire file.
     *
     * @param durationSeconds - Duration in seconds to decode
     * @returns {Float32Array[]} Array of audio channels (1 for mono, 2 for stereo)
     */
    decodeChunk(durationSeconds: number): Float32Array[] {
        const samplesNeeded = Math.ceil(durationSeconds * this.sampleRate);
        const blocksNeeded = Math.ceil(samplesNeeded / this.visualizationMetadata.hopSize);
        return this.decodeNextBlocks(blocksNeeded);
    }

    /**
     * Decodes the entire audio file and returns the complete result.
     * This is a convenience method that seeks to the beginning and decodes all blocks.
     *
     * @returns {AudioResult} Complete decoded audio with metadata
     */
    decodeAll(): AudioResult {
        const totalBlocks = this.visualizationMetadata.totalAudioBlocks;
        this.seek(0);
        const channels = this.decodeNextBlocks(totalBlocks);

        // Clip to actual length
        for (let i = 0; i < channels.length; i++) {
            channels[i] = channels[i].slice(0, this.totalSamples);
        }

        return {
            type: 'audio',
            channels,
            sampleRate: this.sampleRate,
            metadata: this.primarySource.metadata,
            visualizationMetadata: this.visualizationMetadata,
            sourceImageIndex: this.sources.indexOf(this.primarySource),
            decoder: this
        };
    }

    /**
     * Decodes the next sequence of audio blocks and returns the audio samples.
     * Handles stereo mixing, multi-part sources, and overlap-add windowing.
     * @private
     * @param count - Number of audio blocks to decode
     * @returns {Float32Array[]} Decoded audio channels
     */
    private decodeNextBlocks(count: number): Float32Array[] {
        const hopSize = this.visualizationMetadata.hopSize;
        const totalOutSamples = count * hopSize;

        // Check if we need stereo output (have both mid and side channels)
        const midSrcs = this.sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_MID);
        const sideSrcs = this.sources.filter(s => s.channelMode === CHANNEL_MODE.STEREO_SIDE);
        const isStereo = midSrcs.length > 0 && sideSrcs.length > 0;

        const outL = new Float32Array(totalOutSamples);
        const outR = isStereo ? new Float32Array(totalOutSamples) : null;

        // Clamp count to available blocks to prevent over-allocation
        const maxAvailableBlocks = Math.max(0, this.visualizationMetadata.totalAudioBlocks - this.currentAudioBlock);
        const actualCount = Math.min(count, maxAvailableBlocks);

        for (let i = 0; i < actualCount; i++) {
            let winL: Float32Array, winR: Float32Array | null = null;

            if (isStereo) {
                // Stereo multi-part: find the correct mid/side pair for this block
                // Calculate blocks per part for each mid source
                // currentAudioBlock is global across all parts, need to map to correct image pair

                // Find which part this block belongs to by accumulating blocks
                let accumulatedBlocks = 0;
                let midSrc: ImageSource | null = null;
                let sideSrc: ImageSource | null = null;
                let localBlockInPart = this.currentAudioBlock;

                // Sort mid sources by imageIndex to process in order
                const sortedMids = [...midSrcs].sort((a, b) => a.imageIndex - b.imageIndex);

                for (const mid of sortedMids) {
                    const blocksInThisPart = Math.ceil(mid.totalSamples / this.visualizationMetadata.hopSize);

                    if (this.currentAudioBlock < accumulatedBlocks + blocksInThisPart) {
                        // This block belongs to this part
                        midSrc = mid;
                        localBlockInPart = this.currentAudioBlock - accumulatedBlocks;

                        // Find corresponding side channel (imageIndex = mid.imageIndex + 1)
                        sideSrc = sideSrcs.find(s => s.imageIndex === mid.imageIndex + 1) || null;
                        break;
                    }

                    accumulatedBlocks += blocksInThisPart;
                }

                if (midSrc && sideSrc) {
                    // Decode both channels
                    const midWin = this.decodeWindowFromSource(midSrc, localBlockInPart);
                    const midData = new Float32Array(midWin);
                    const sideWin = this.decodeWindowFromSource(sideSrc, localBlockInPart);

                    winL = midData;
                    winR = sideWin;
                    // Mix: L = M+S, R = M-S
                    for (let k = 0; k < this.windowSize; k++) {
                        const m = midData[k];
                        const s = sideWin[k];
                        winL[k] = m + s;
                        winR[k] = m - s;
                    }
                } else if (midSrc) {
                    // Missing side channel, fallback to mono (duplicate mid to both channels)
                    const midWin = this.decodeWindowFromSource(midSrc, localBlockInPart);
                    winL = midWin;
                    winR = midWin; // Duplicate mono to stereo
                } else {
                    // Missing source, use silence
                    winL = new Float32Array(this.windowSize);
                    if (outR) winR = new Float32Array(this.windowSize);
                }
            } else if (midSrcs.length > 0) {
                // Only mid sources (mono from mid channel)
                // Find which part this block belongs to by accumulating blocks
                let accumulatedBlocks = 0;
                let midSrc: ImageSource | null = null;
                let localBlockInPart = this.currentAudioBlock;

                const sortedMids = [...midSrcs].sort((a, b) => a.imageIndex - b.imageIndex);

                for (const mid of sortedMids) {
                    const blocksInThisPart = Math.ceil(mid.totalSamples / this.visualizationMetadata.hopSize);

                    if (this.currentAudioBlock < accumulatedBlocks + blocksInThisPart) {
                        midSrc = mid;
                        localBlockInPart = this.currentAudioBlock - accumulatedBlocks;
                        break;
                    }

                    accumulatedBlocks += blocksInThisPart;
                }

                if (midSrc) {
                    winL = this.decodeWindowFromSource(midSrc, localBlockInPart);
                } else {
                    winL = new Float32Array(this.windowSize);
                }
            } else {
                // Fallback to old logic for single-file audio
                let localAudioBlockIdx = this.currentAudioBlock;
                let targetSrc = this.sources[0];
                let found = false;

                for (const src of this.sources) {
                    const blocksInThisSource = Math.ceil(src.totalSamples / this.visualizationMetadata.hopSize);
                    if (localAudioBlockIdx < blocksInThisSource) {
                        targetSrc = src;
                        found = true;
                        break;
                    }
                    localAudioBlockIdx -= blocksInThisSource;
                }

                if (found) {
                    winL = this.decodeWindowFromSource(targetSrc, localAudioBlockIdx);

                    if (targetSrc.channelMode === CHANNEL_MODE.STEREO_MID) {
                        // For stereo single-file, find corresponding side
                        const sideSrc = this.sources.find(s => s.channelMode === CHANNEL_MODE.STEREO_SIDE &&
                            s.imageIndex === targetSrc.imageIndex + 1);
                        if (sideSrc) {
                            const midWin = winL;
                            const midData = new Float32Array(midWin);
                            const sideWin = this.decodeWindowFromSource(sideSrc, localAudioBlockIdx);
                            winR = sideWin;
                            // Mix
                            for (let k = 0; k < this.windowSize; k++) {
                                const m = midData[k];
                                const s = sideWin[k];
                                winL[k] = m + s;
                                winR[k] = m - s;
                            }
                        }
                    }
                } else {
                    winL = new Float32Array(this.windowSize);
                }
            }

            const outPos = i * hopSize;
            for (let k = 0; k < hopSize; k++) {
                outL[outPos + k] = this.overlapL[k] + winL[k];
                this.overlapL[k] = winL[k + hopSize];
                if (outR && winR) {
                    outR[outPos + k] = this.overlapR[k] + winR[k];
                    this.overlapR[k] = winR[k + hopSize];
                }
            }
            this.currentAudioBlock++;
        }

        if (outR) return [outL, outR];
        return [outL];
    }

    /**
     * Decodes a single audio window from a specific image source.
     * Extracts the appropriate block from the image and decodes it to time-domain samples.
     * @private
     * @param src - The image source to decode from
     * @param localAudioBlockIdx - Block index within this specific source
     * @returns {Float32Array} Decoded audio window samples
     */
    private decodeWindowFromSource(src: ImageSource, localAudioBlockIdx: number): Float32Array {
        // Validate block index bounds for this source
        const blocksInThisSource = Math.ceil(src.totalSamples / this.visualizationMetadata.hopSize);
        if (localAudioBlockIdx < 0 || localAudioBlockIdx >= blocksInThisSource) {
            return new Float32Array(this.windowSize); // Return silence for out-of-bounds
        }

        // Now localAudioBlockIdx is the block index within this specific source
        const imgBlockIdxBase = localAudioBlockIdx;

        const rowInAudioArea = Math.floor(imgBlockIdxBase / DATA_BLOCKS_PER_ROW);
        const colInAudioArea = imgBlockIdxBase % DATA_BLOCKS_PER_ROW;
        const absRow = 2 + rowInAudioArea;

        const metaBlockAbsIdx = (absRow * BLOCKS_PER_ROW) + DATA_BLOCKS_PER_ROW;
        const imgBlockAbsIdx = (absRow * BLOCKS_PER_ROW) + colInAudioArea;

        const { scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY, bandFactorsA, bandFactorsB, sbrData } = this.getCachedRowMetadata(src, metaBlockAbsIdx);

        const isSubgroupA = colInAudioArea < SUBGROUP_A_SIZE;
        const isSubgroupX = (colInAudioArea % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;
        const scaleY = isSubgroupA ? scaleYA : scaleYB;
        const scaleC = isSubgroupA
            ? (isSubgroupX ? scaleCAX : scaleCAY)
            : (isSubgroupX ? scaleCBX : scaleCBY);
        const bandFactors = isSubgroupA ? bandFactorsA : bandFactorsB;
        const whiteningProfile = this.getWhiteningProfile(src.sampleRate);

        // Calculate a deterministic seed for SBR noise that is shared between Mid/Side channels.
        // For stereo, imageIndex 1 & 2 are chunk 0, 3 & 4 are chunk 1, etc.
        const isStereo = src.channelMode === CHANNEL_MODE.STEREO_MID || src.channelMode === CHANNEL_MODE.STEREO_SIDE;
        const chunkIdx = isStereo ? Math.floor((src.imageIndex - 1) / 2) : (src.imageIndex - 1);

        // Combine header random bytes (salt) with temporal position
        // salt (src.randomBytes) is shared across all images of the same audio file.
        const salt = (src.randomBytes[0] << 24) | (src.randomBytes[1] << 16) | (src.randomBytes[2] << 8) | src.randomBytes[3];
        // Include src.channelMode to ensure Mid and Side channels get UNCORRELATED noise.
        const sbrSeed = (salt ^ chunkIdx ^ localAudioBlockIdx ^ src.channelMode) | 0;

        return decodeBlock(
            src.data, src.width, imgBlockAbsIdx, scaleY, scaleC, whiteningProfile, bandFactors,
            this.buffers.coeffs, this.buffers.decodedWindow, this.mdctWindow,
            this.buffers, sbrData, colInAudioArea,
            undefined, // debugCapture
            sbrSeed
        );
    }
}
