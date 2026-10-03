// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import {
    prepareAudioRow,
    prepareRowPairChroma,
    writePreparedAudioRow,
    writePreparedAudioRowPair,
} from './encoder/audioMath';
import type { EncodeRowBuffers, RowMetadataWriter, PreparedAudioRow } from './encoder/audioMath';
import { decodeBlockToCoefficients } from './decoder/audioMath';
import type { DecodeBlockBuffers } from './decoder/audioMath';
import { AudioEncoder } from './encoder/audio';
import type { SimpleImageData } from './encoder/audio';
import { PxfEncoder } from './encoder';
import { PxfDecoder } from './decoder';
import { getSineWindow } from './utils/audioUtils';
import { getMdctWhiteningProfile } from './utils/mdctWhitening';
import { createRNG } from './utils/rng';
import { AUDIO_PIXEL_MAPPING_PRESETS, AUDIO_PSYCHOACOUSTICS, getBlockMapForVersion } from './psychoacoustics';
import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    IMAGE_WIDTH,
    MDCT_HOP_SIZE,
    MDCT_WINDOW_SIZE,
    SUBGROUP_A_SIZE,
    SUBGROUP_X_SIZE,
} from './constants';

const FIRST_AUDIO_BLOCK_INDEX = 2 * BLOCKS_PER_ROW;

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
    const isA = col < SUBGROUP_A_SIZE;
    const isX = (col % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;
    return isA
        ? (isX ? row.scaleCAX : row.scaleCAY)
        : (isX ? row.scaleCBX : row.scaleCBY);
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

const noopMetadataWriter: RowMetadataWriter = () => { };

describe('4:2:0 chroma (v301 superblocks)', () => {
    it('round-trips all bins through the v301 pair layout at the math layer', () => {
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
        writePreparedAudioRowPair(
            0, FIRST_AUDIO_BLOCK_INDEX, top, bottom, pairChroma,
            imageData, noopMetadataWriter
        );

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
                const blockIndex = FIRST_AUDIO_BLOCK_INDEX + r * BLOCKS_PER_ROW + i;
                const scaleY = i < SUBGROUP_A_SIZE ? row.scaleYA : row.scaleYB;
                const bandFactors = i < SUBGROUP_A_SIZE ? row.bandFactorsA : row.bandFactorsB;

                decodeBlockToCoefficients(
                    imageData.data, IMAGE_WIDTH, blockIndex,
                    scaleY, chromaScaleFor(row, i),
                    whiteningProfile, bandFactors, coeffBuffer, decodeBuffers,
                    undefined, 301
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

    it('still round-trips the legacy v300 per-block layout at the math layer', () => {
        const totalAudioBlocks = 40;
        const paddedAudio = makeNoiseAudio(totalAudioBlocks, 6789);
        const mdctWindow = getSineWindow(MDCT_WINDOW_SIZE);
        const whiteningProfile = getMdctWhiteningProfile(44100);
        const buffers = makeEncodeBuffers();

        const row = prepareAudioRow(
            totalAudioBlocks, 0, totalAudioBlocks, paddedAudio,
            MDCT_HOP_SIZE, MDCT_WINDOW_SIZE, mdctWindow, whiteningProfile, buffers, 300
        );

        const imageData = makeImage(1);
        writePreparedAudioRow(
            0, FIRST_AUDIO_BLOCK_INDEX, row, imageData, buffers, noopMetadataWriter, 300
        );

        const decodeBuffers = makeDecodeBuffers();
        const coeffBuffer = new Float32Array(128);
        const origAll: number[] = [];
        const decAll: number[] = [];

        for (let i = 0; i < row.rowDataCount; i++) {
            const blockIndex = FIRST_AUDIO_BLOCK_INDEX + i;
            const scaleY = i < SUBGROUP_A_SIZE ? row.scaleYA : row.scaleYB;
            const bandFactors = i < SUBGROUP_A_SIZE ? row.bandFactorsA : row.bandFactorsB;

            decodeBlockToCoefficients(
                imageData.data, IMAGE_WIDTH, blockIndex,
                scaleY, chromaScaleFor(row, i),
                whiteningProfile, bandFactors, coeffBuffer, decodeBuffers,
                undefined, 300
            );

            const orig = row.rowMDCTCoeffs[i];
            for (let k = 0; k < 96; k++) {
                origAll.push(orig[k]);
                decAll.push(coeffBuffer[k]);
            }
        }

        expect(relativeRmse(origAll, decAll)).toBeLessThan(0.05);
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

describe('format-version coefficient map', () => {
    it('reads v300 images with the zigzag map they were written with', () => {
        expect(getBlockMapForVersion(300)).toBe(AUDIO_PIXEL_MAPPING_PRESETS.zigzag);
        expect(getBlockMapForVersion(301)).toBe(AUDIO_PSYCHOACOUSTICS.blockMap);
        expect(AUDIO_PSYCHOACOUSTICS.blockMap).not.toBe(AUDIO_PIXEL_MAPPING_PRESETS.zigzag);
    });
});
