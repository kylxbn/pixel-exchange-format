// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import {
    prepareAudioRow,
    prepareRowPairChroma,
    writeRowPairPixels,
} from './encoder/audioMath';
import type { EncodeRowBuffers, PreparedAudioRow } from './encoder/audioMath';
import { decodeBlockToCoefficients } from './decoder/audioMath';
import type { DecodeBlockBuffers } from './decoder/audioMath';
import { AudioEncoder } from './encoder/audio';
import type { SimpleImageData } from './encoder/types';
import { PxfEncoder } from './encoder';
import { PxfDecoder } from './decoder';
import { getSineWindow } from './utils/audioUtils';
import { getMdctWhiteningProfile } from './utils/mdctWhitening';
import { createRNG } from './utils/rng';
import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    IMAGE_WIDTH,
    MDCT_HOP_SIZE,
    MDCT_WINDOW_SIZE,
} from './constants';
import {
    audioBlockToImageBlock,
    chromaGroupIndex,
    imageBlockToAudioBlock,
    isLumaSubgroupA,
} from './audioLayout';
import { decodeRGBToPoint } from './utils/obb';
import { simulateJpegChannel } from './encoder/jpegChannel';

function makeEncodeBuffers(): EncodeRowBuffers {
    return {
        winFrame: new Float32Array(MDCT_WINDOW_SIZE),
        mdctCoeffs: new Float32Array(MDCT_HOP_SIZE),
        dctY: new Float32Array(64),
        dctCb: new Float32Array(64),
        dctCr: new Float32Array(64),
        spatialY: new Float32Array(64),
        spatialCb: new Float32Array(64),
        spatialCr: new Float32Array(64),
        temp: new Float32Array(64),
    };
}

function makeDecodeBuffers(): DecodeBlockBuffers {
    return {
        spatialY: new Float32Array(64),
        spatialCb: new Float32Array(64),
        spatialCr: new Float32Array(64),
        dctY: new Float32Array(64),
        dctCb: new Float32Array(64),
        dctCr: new Float32Array(64),
        temp: new Float32Array(64),
    };
}

function makeImage(dataRows: number): SimpleImageData {
    const height = (2 + dataRows) * 8;
    const data = new Uint8ClampedArray(IMAGE_WIDTH * height * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { data, width: IMAGE_WIDTH, height };
}

function makeNoiseAudio(totalAudioBlocks: number, seed: number): Float32Array {
    const paddedAudio = new Float32Array((totalAudioBlocks + 1) * MDCT_HOP_SIZE * 2);
    const rng = createRNG(seed);
    for (let i = 0; i < totalAudioBlocks * MDCT_HOP_SIZE; i++) {
        paddedAudio[i] = ((rng.nextByte() / 255) * 2 - 1) * 0.5;
    }
    return paddedAudio;
}

function chromaScaleFor(row: PreparedAudioRow, col: number): number {
    return [row.scaleCAX, row.scaleCAY, row.scaleCBX, row.scaleCBY][chromaGroupIndex(col)];
}

function relativeRmse(orig: number[], dec: number[]): number {
    let errSum = 0;
    let refSum = 0;
    for (let i = 0; i < orig.length; i++) {
        const diff = orig[i] - dec[i];
        errSum += diff * diff;
        refSum += orig[i] * orig[i];
    }
    return Math.sqrt(errSum / (refSum + 1e-12));
}

describe('4:2:0 chroma superblocks', () => {
    it('round-trips all bins through the row pair layout at the math layer', () => {
        const totalAudioBlocks = DATA_BLOCKS_PER_ROW + 6; // partial bottom row
        const paddedAudio = makeNoiseAudio(totalAudioBlocks, 12345);
        const mdctWindow = getSineWindow(MDCT_WINDOW_SIZE);
        const whiteningProfile = getMdctWhiteningProfile(44100);
        const buffers = makeEncodeBuffers();

        const top = prepareAudioRow(
            DATA_BLOCKS_PER_ROW, 0, totalAudioBlocks, paddedAudio,
            MDCT_HOP_SIZE, MDCT_WINDOW_SIZE, mdctWindow, whiteningProfile, buffers
        );
        const bottom = prepareAudioRow(
            6, DATA_BLOCKS_PER_ROW, totalAudioBlocks, paddedAudio,
            MDCT_HOP_SIZE, MDCT_WINDOW_SIZE, mdctWindow, whiteningProfile, buffers
        );

        const pairChroma = prepareRowPairChroma(top, bottom, buffers);
        expect(top.scaleCAX).toBeGreaterThan(0);
        expect(bottom.scaleCAX).toBeGreaterThan(0);

        const imageData = makeImage(2);
        writeRowPairPixels(0, top, bottom, pairChroma, imageData);

        const decodeBuffers = makeDecodeBuffers();
        const coeffBuffer = new Float32Array(128);
        const rows = [top, bottom];

        for (let r = 0; r < 2; r++) {
            const row = rows[r];
            const origLuma: number[] = [];
            const decLuma: number[] = [];
            const origChroma: number[] = [];
            const decChroma: number[] = [];

            for (let i = 0; i < row.rowDataCount; i++) {
                const blockIndex = audioBlockToImageBlock(r, i);
                const scaleY = isLumaSubgroupA(i) ? row.scaleYA : row.scaleYB;
                const bandFactors = isLumaSubgroupA(i) ? row.bandFactorsA : row.bandFactorsB;

                decodeBlockToCoefficients(
                    imageData.data, IMAGE_WIDTH, blockIndex,
                    scaleY, chromaScaleFor(row, i),
                    whiteningProfile, bandFactors, coeffBuffer, decodeBuffers
                );

                const orig = row.rowMDCTCoeffs[i];
                for (let k = 0; k < 64; k++) {
                    origLuma.push(orig[k]);
                    decLuma.push(coeffBuffer[k]);
                }
                for (let k = 64; k < 96; k++) {
                    origChroma.push(orig[k]);
                    decChroma.push(coeffBuffer[k]);
                }
            }

            expect(relativeRmse(origLuma, decLuma)).toBeLessThan(0.05);
            expect(relativeRmse(origChroma, decChroma)).toBeLessThan(0.05);
        }
    });

    it('stores audio blocks in JPEG 4:2:0 MCU order', () => {
        // First row of a pair: left 31 MCUs, blocks TL, TR, BL, BR per MCU
        expect(audioBlockToImageBlock(0, 0)).toBe(2 * BLOCKS_PER_ROW);
        expect(audioBlockToImageBlock(0, 1)).toBe(2 * BLOCKS_PER_ROW + 1);
        expect(audioBlockToImageBlock(0, 2)).toBe(3 * BLOCKS_PER_ROW);
        expect(audioBlockToImageBlock(0, 3)).toBe(3 * BLOCKS_PER_ROW + 1);
        expect(audioBlockToImageBlock(0, 4)).toBe(2 * BLOCKS_PER_ROW + 2);
        expect(audioBlockToImageBlock(0, 123)).toBe(3 * BLOCKS_PER_ROW + 61);
        // Second row of the pair: right 31 MCUs
        expect(audioBlockToImageBlock(1, 0)).toBe(2 * BLOCKS_PER_ROW + 62);
        expect(audioBlockToImageBlock(1, 123)).toBe(3 * BLOCKS_PER_ROW + 123);
        expect(audioBlockToImageBlock(2, 0)).toBe(4 * BLOCKS_PER_ROW);

        const seen = new Set<number>();
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < DATA_BLOCKS_PER_ROW; col++) {
                const blockIndex = audioBlockToImageBlock(row, col);
                seen.add(blockIndex);
                expect(imageBlockToAudioBlock(
                    Math.floor(blockIndex / BLOCKS_PER_ROW), blockIndex % BLOCKS_PER_ROW
                )).toEqual({ rowInAudioArea: row, colInAudioArea: col });
            }
        }
        expect(seen.size).toBe(4 * DATA_BLOCKS_PER_ROW);
        expect(imageBlockToAudioBlock(1, 0)).toBeNull();
        expect(imageBlockToAudioBlock(2, DATA_BLOCKS_PER_ROW)).toBeNull();
    });

    it('keeps every MCU inside one luma and one chroma scale group', () => {
        for (let col = 0; col < DATA_BLOCKS_PER_ROW; col++) {
            const mcuStart = col - (col % 4);
            expect(isLumaSubgroupA(col)).toBe(isLumaSubgroupA(mcuStart));
            expect(chromaGroupIndex(col)).toBe(chromaGroupIndex(mcuStart));
            // Chroma groups nest inside the luma subgroups
            expect(chromaGroupIndex(col) < 2).toBe(isLumaSubgroupA(col));
        }
        expect(isLumaSubgroupA(63)).toBe(true);
        expect(isLumaSubgroupA(64)).toBe(false);
        expect([31, 32, 63, 64, 95, 96, 123].map(col => chromaGroupIndex(col)))
            .toEqual([0, 1, 1, 2, 2, 3, 3]);
    });

    it('uses the full chroma range of each scale group without clipping', () => {
        // Loud first half, quiet second half: groups must be scaled independently
        const totalAudioBlocks = 2 * DATA_BLOCKS_PER_ROW;
        const paddedAudio = makeNoiseAudio(totalAudioBlocks, 4242);
        for (let i = DATA_BLOCKS_PER_ROW * MDCT_HOP_SIZE; i < paddedAudio.length; i++) paddedAudio[i] *= 0.01;
        const mdctWindow = getSineWindow(MDCT_WINDOW_SIZE);
        const whiteningProfile = getMdctWhiteningProfile(44100);
        const buffers = makeEncodeBuffers();

        const rows = [0, 1].map(r => prepareAudioRow(
            DATA_BLOCKS_PER_ROW, r * DATA_BLOCKS_PER_ROW, totalAudioBlocks, paddedAudio,
            MDCT_HOP_SIZE, MDCT_WINDOW_SIZE, mdctWindow, whiteningProfile, buffers
        ));
        const { superCb, superCr } = prepareRowPairChroma(rows[0], rows[1], buffers);

        for (let r = 0; r < 2; r++) {
            const groupMax = [0, 0, 0, 0];
            for (let m = 0; m < DATA_BLOCKS_PER_ROW / 4; m++) {
                const off = (r * (DATA_BLOCKS_PER_ROW / 4) + m) * 64;
                const g = chromaGroupIndex(m * 4);
                for (let j = 0; j < 64; j++) {
                    groupMax[g] = Math.max(groupMax[g], Math.abs(superCb[off + j]), Math.abs(superCr[off + j]));
                }
            }
            for (const max of groupMax) expect(max).toBeCloseTo(1, 5);
        }
        expect(rows[1].scaleCAX).toBeGreaterThan(rows[0].scaleCAX * 10);
    });

    it('writes chroma that is constant over each 2x2 pixel group', () => {
        const totalAudioBlocks = 2 * DATA_BLOCKS_PER_ROW;
        const paddedAudio = makeNoiseAudio(totalAudioBlocks, 777);
        const mdctWindow = getSineWindow(MDCT_WINDOW_SIZE);
        const whiteningProfile = getMdctWhiteningProfile(44100);
        const buffers = makeEncodeBuffers();
        const rows = [0, 1].map(r => prepareAudioRow(
            DATA_BLOCKS_PER_ROW, r * DATA_BLOCKS_PER_ROW, totalAudioBlocks, paddedAudio,
            MDCT_HOP_SIZE, MDCT_WINDOW_SIZE, mdctWindow, whiteningProfile, buffers
        ));
        const pairChroma = prepareRowPairChroma(rows[0], rows[1], buffers);
        const imageData = makeImage(2);
        writeRowPairPixels(0, rows[0], rows[1], pairChroma, imageData);

        // RGB rounding moves a decoded chroma sample slightly; NN upsampling
        // keeps the four pixels of a chroma sample within that tolerance.
        let worst = 0;
        for (let y = 16; y < 32; y += 2) {
            for (let x = 0; x < DATA_BLOCKS_PER_ROW * 8; x += 2) {
                const samples = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => {
                    const off = ((y + dy) * IMAGE_WIDTH + (x + dx)) * 4;
                    return decodeRGBToPoint(imageData.data[off], imageData.data[off + 1], imageData.data[off + 2]);
                });
                for (const c of [1, 2]) {
                    const values = samples.map(p => p[c]);
                    worst = Math.max(worst, Math.max(...values) - Math.min(...values));
                }
            }
        }
        expect(worst).toBeLessThan(0.05);
    });

    it('pads data rows to an even count in calculateDimensions', () => {
        const samplesForBlocks = (blocks: number) => blocks * MDCT_HOP_SIZE;

        // 1 data row -> padded to 2
        expect(AudioEncoder.calculateDimensions(samplesForBlocks(10)).height).toBe((2 + 2) * 8);
        // 2 data rows -> stays 2
        expect(AudioEncoder.calculateDimensions(samplesForBlocks(DATA_BLOCKS_PER_ROW + 1)).height).toBe((2 + 2) * 8);
        // 3 data rows -> padded to 4
        expect(AudioEncoder.calculateDimensions(samplesForBlocks(2 * DATA_BLOCKS_PER_ROW + 1)).height).toBe((2 + 4) * 8);
    });

    it('round-trips an odd number of data rows end-to-end', async () => {
        const sampleRate = 44100;
        const length = MDCT_HOP_SIZE * (2 * DATA_BLOCKS_PER_ROW + 12); // 3 data rows
        const channelData = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            channelData[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sampleRate);
        }

        const encodedResults = await PxfEncoder.encode(
            { audio: { channels: [channelData], sampleRate } },
            { 'fn': 'oddrows' }
        );
        expect(encodedResults.length).toBe(1);
        expect(encodedResults[0].height % 16).toBe(0);

        const source = PxfDecoder.load(encodedResults[0]);
        const decodedResult = await PxfDecoder.decode([source]);
        if (decodedResult.type !== 'audio') {
            throw new Error('Decoder returned unexpected binary result for audio source');
        }

        const decodedData = decodedResult.channels[0];
        let errorSum = 0;
        const len = Math.min(channelData.length, decodedData.length);
        for (let i = 0; i < len; i++) {
            const diff = channelData[i] - decodedData[i];
            errorSum += diff * diff;
        }
        expect(Math.sqrt(errorSum / len)).toBeLessThan(0.06);
    });
});

describe('JPEG transport model', () => {
    it('leaves flat areas alone and disturbs audio pixels only slightly', async () => {
        const flat = new Uint8ClampedArray(32 * 16 * 4).fill(128);
        expect(Array.from(simulateJpegChannel(flat, 32, 16)).filter((_, i) => i % 4 !== 3).every(v => v === 128)).toBe(true);

        const channelData = makeNoiseAudio(DATA_BLOCKS_PER_ROW * 2, 99).subarray(0, DATA_BLOCKS_PER_ROW * 2 * MDCT_HOP_SIZE);
        const [image] = await PxfEncoder.encode({ audio: { channels: [channelData], sampleRate: 44100 } }, { fn: 'channel' });
        const out = simulateJpegChannel(image.data, image.width, image.height);

        let errorSum = 0;
        let count = 0;
        for (let i = 16 * IMAGE_WIDTH * 4; i < out.length; i++) {
            if (i % 4 === 3) continue;
            errorSum += Math.abs(out[i] - image.data[i]);
            count++;
        }
        const meanError = errorSum / count;
        expect(meanError).toBeGreaterThan(0.5);
        expect(meanError).toBeLessThan(8);
    });
});
