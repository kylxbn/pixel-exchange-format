// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { dct8x8, idct8x8 } from './audioUtils';
import { createRNG } from './rng';
import { BINARY_SCRAMBLE_SEED, IMAGE_WIDTH, LDPC_BINARY_SEED } from '../constants';
import { buildDeckGraph, LdpcCode } from '../ldpc';

// Binary mode writes its bits as PAM symbols on 8x8 DCT coefficients, on the
// grid a 4:2:0 JPEG encoder uses: one luma block per 8x8 pixels and one chroma
// block per 16x16 pixels. Each coefficient gets a level spacing just above the
// quantizer step of libjpeg quality 90 and as many bits as the pixel range can
// afford, so a JPEG round-trip moves a symbol by less than half a spacing.

const QUANT_LUMA_Q90 = [
    3, 2, 2, 3, 5, 8, 10, 12,
    2, 2, 3, 4, 5, 12, 12, 11,
    3, 3, 3, 5, 8, 11, 14, 11,
    3, 3, 4, 6, 10, 17, 16, 12,
    4, 4, 7, 11, 14, 22, 21, 15,
    5, 7, 11, 13, 16, 21, 23, 18,
    10, 13, 16, 17, 21, 24, 24, 20,
    14, 18, 19, 20, 22, 20, 21, 20
];

const QUANT_CHROMA_Q90 = [
    3, 4, 5, 9, 20, 20, 20, 20,
    4, 4, 5, 13, 20, 20, 20, 20,
    5, 5, 11, 20, 20, 20, 20, 20,
    9, 13, 20, 20, 20, 20, 20, 20,
    20, 20, 20, 20, 20, 20, 20, 20,
    20, 20, 20, 20, 20, 20, 20, 20,
    20, 20, 20, 20, 20, 20, 20, 20,
    20, 20, 20, 20, 20, 20, 20, 20
];

export const BINARY_LUMA_BITS = [
    5, 5, 5, 5, 4, 3, 3, 3,
    5, 5, 5, 4, 4, 3, 3, 3,
    5, 5, 5, 4, 3, 3, 3, 3,
    5, 5, 4, 4, 3, 3, 3, 3,
    4, 4, 4, 3, 3, 2, 2, 3,
    4, 4, 3, 3, 3, 2, 2, 2,
    3, 3, 3, 3, 2, 2, 2, 2,
    3, 2, 2, 2, 2, 2, 2, 2
];

export const BINARY_CHROMA_BITS = [
    3, 3, 3, 2, 1, 1, 1, 1,
    3, 3, 3, 2, 1, 1, 1, 1,
    3, 3, 2, 1, 1, 1, 1, 1,
    2, 2, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1
];

export const BINARY_LUMA_STEP = QUANT_LUMA_Q90.map(q => 1.15 * q + 2);
export const BINARY_CHROMA_STEP = QUANT_CHROMA_Q90.map(q => 1.2 * q + 2);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const BINARY_STRIP_HEIGHT = 16;
export const BINARY_MCUS_PER_STRIP = IMAGE_WIDTH / 16; // 64
export const BINARY_LUMA_BLOCKS_PER_STRIP = BINARY_MCUS_PER_STRIP * 4; // 256
export const BINARY_BITS_PER_LUMA_BLOCK = sum(BINARY_LUMA_BITS);
export const BINARY_BITS_PER_CHROMA_BLOCK = sum(BINARY_CHROMA_BITS);
export const BINARY_BITS_PER_MCU = 4 * BINARY_BITS_PER_LUMA_BLOCK + 2 * BINARY_BITS_PER_CHROMA_BLOCK;
export const BINARY_STRIP_CODED_BITS = BINARY_MCUS_PER_STRIP * BINARY_BITS_PER_MCU;

// One LDPC codeword per strip: payload, then its CRC32C, then parity, all at the same density
export const BINARY_STRIP_CRC_BYTES = 4;
export const BINARY_STRIP_PARITY_BITS = 6496;
export const LDPC_BINARY_N = BINARY_STRIP_CODED_BITS;
export const LDPC_BINARY_K = LDPC_BINARY_N - BINARY_STRIP_PARITY_BITS;
export const BINARY_STRIP_DATA_CAPACITY = LDPC_BINARY_K / 8 - BINARY_STRIP_CRC_BYTES;

let binaryLdpc: LdpcCode | null = null;

/** The strip code is built on first use; its graph is too large to ship precomputed. */
export function getBinaryLdpc(): LdpcCode {
    if (!binaryLdpc) binaryLdpc = new LdpcCode(buildDeckGraph(LDPC_BINARY_N, LDPC_BINARY_K, LDPC_BINARY_SEED));
    return binaryLdpc;
}

/** Whitening mask for the codeword of one strip, so that any payload spreads evenly over the levels. */
export function generateBinaryScrambleMask(stripIndex: number): Uint8Array {
    const rng = createRNG(BINARY_SCRAMBLE_SEED + stripIndex);
    const mask = new Uint8Array(LDPC_BINARY_N / 8);
    for (let i = 0; i < mask.length; i++) mask[i] = rng.nextByte();
    return mask;
}

// Fraction of a level spacing a coefficient may be moved to bring a pixel back into the RGB cube
const GAMUT_TOLERANCE = 0.15;
const GAMUT_ITERATIONS = 8;

// Likelihood model: Gaussian core plus a wide Gaussian that keeps outliers from being trusted
const TAIL_WEIGHT = 0.02;
const TAIL_WIDTH = 3.0;
const SIGMA_FLOOR = 0.05;
const LLR_LIMIT = 25;

/** Coefficients of one strip: 256 luma blocks in raster order, then 64 Cb and 64 Cr blocks. */
export interface StripCoefficients {
    luma: Float32Array;
    cb: Float32Array;
    cr: Float32Array;
}

export function createStripCoefficients(): StripCoefficients {
    return {
        luma: new Float32Array(BINARY_LUMA_BLOCKS_PER_STRIP * 64),
        cb: new Float32Array(BINARY_MCUS_PER_STRIP * 64),
        cr: new Float32Array(BINARY_MCUS_PER_STRIP * 64)
    };
}

/** Per-coefficient noise estimate for the three planes (64 values each). */
export interface NoiseModel {
    luma: Float32Array;
    cb: Float32Array;
    cr: Float32Array;
}

/**
 * Visits the coefficient blocks of a strip in transmission order: for each MCU
 * left to right, its four luma blocks (top-left, top-right, bottom-left,
 * bottom-right), then its Cb block, then its Cr block.
 */
function forEachBlock(
    coefs: StripCoefficients,
    visit: (plane: Float32Array, offset: number, bits: number[], step: number[]) => void
): void {
    const lumaBlocksPerRow = BINARY_MCUS_PER_STRIP * 2;
    for (let mcu = 0; mcu < BINARY_MCUS_PER_STRIP; mcu++) {
        visit(coefs.luma, (2 * mcu) * 64, BINARY_LUMA_BITS, BINARY_LUMA_STEP);
        visit(coefs.luma, (2 * mcu + 1) * 64, BINARY_LUMA_BITS, BINARY_LUMA_STEP);
        visit(coefs.luma, (lumaBlocksPerRow + 2 * mcu) * 64, BINARY_LUMA_BITS, BINARY_LUMA_STEP);
        visit(coefs.luma, (lumaBlocksPerRow + 2 * mcu + 1) * 64, BINARY_LUMA_BITS, BINARY_LUMA_STEP);
        visit(coefs.cb, mcu * 64, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP);
        visit(coefs.cr, mcu * 64, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP);
    }
}

function grayToIndex(gray: number): number {
    let index = gray;
    for (let shift = gray >> 1; shift > 0; shift >>= 1) index ^= shift;
    return index;
}

/** Maps the coded bits of a strip (one bit per byte) to coefficient amplitudes. */
export function modulateStrip(bits: Uint8Array): StripCoefficients {
    const coefs = createStripCoefficients();
    let bitPos = 0;
    forEachBlock(coefs, (plane, offset, bitTable, stepTable) => {
        for (let k = 0; k < 64; k++) {
            const width = bitTable[k];
            let gray = 0;
            for (let b = 0; b < width; b++) gray = (gray << 1) | bits[bitPos++];
            const levels = 1 << width;
            plane[offset + k] = (grayToIndex(gray) - (levels - 1) / 2) * stepTable[k];
        }
    });
    return coefs;
}

function clampByte(value: number): number {
    return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Renders a strip to RGBA pixels at row `baseY`. Pixels that would leave the RGB
 * cube are clipped, and the damage that does to the coefficients is pushed back
 * until no coefficient is off its symbol by more than the tolerance. The outermost
 * levels may move outward freely, since that only adds distance.
 */
export function renderStrip(target: StripCoefficients, out: Uint8ClampedArray, baseY: number): void {
    const width = IMAGE_WIDTH;
    const chromaWidth = width / 2;
    const planeY = new Float32Array(width * BINARY_STRIP_HEIGHT);
    const planeCb = new Float32Array(chromaWidth * (BINARY_STRIP_HEIGHT / 2));
    const planeCr = new Float32Array(chromaWidth * (BINARY_STRIP_HEIGHT / 2));
    const spatial = new Float32Array(64);
    const coefs = new Float32Array(64);
    const temp = new Float32Array(64);

    const synthesize = (plane: Float32Array, planeWidth: number, source: Float32Array) => {
        const blocksPerRow = planeWidth / 8;
        const blocks = source.length / 64;
        for (let block = 0; block < blocks; block++) {
            const bx = (block % blocksPerRow) * 8;
            const by = Math.floor(block / blocksPerRow) * 8;
            idct8x8(source.subarray(block * 64, block * 64 + 64), spatial, temp);
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    plane[(by + y) * planeWidth + bx + x] = spatial[y * 8 + x] + 128;
                }
            }
        }
    };

    // Re-projects a clipped plane onto the coefficients it is allowed to have
    const constrain = (plane: Float32Array, planeWidth: number, wanted: Float32Array, bitTable: number[], stepTable: number[]) => {
        const blocksPerRow = planeWidth / 8;
        const blocks = wanted.length / 64;
        for (let block = 0; block < blocks; block++) {
            const bx = (block % blocksPerRow) * 8;
            const by = Math.floor(block / blocksPerRow) * 8;
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    spatial[y * 8 + x] = plane[(by + y) * planeWidth + bx + x] - 128;
                }
            }
            dct8x8(spatial, coefs, temp);
            for (let k = 0; k < 64; k++) {
                const goal = wanted[block * 64 + k];
                const slack = GAMUT_TOLERANCE * stepTable[k];
                const outermost = (((1 << bitTable[k]) - 1) / 2) * stepTable[k];
                let error = coefs[k] - goal;
                if (error > slack && !(bitTable[k] > 0 && goal >= outermost)) error = slack;
                if (error < -slack && !(bitTable[k] > 0 && goal <= -outermost)) error = -slack;
                coefs[k] = goal + error;
            }
            idct8x8(coefs, spatial, temp);
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    plane[(by + y) * planeWidth + bx + x] = spatial[y * 8 + x] + 128;
                }
            }
        }
    };

    synthesize(planeY, width, target.luma);
    synthesize(planeCb, chromaWidth, target.cb);
    synthesize(planeCr, chromaWidth, target.cr);

    const clippedY = new Float32Array(planeY.length);
    const clippedCb = new Float32Array(planeCb.length);
    const clippedCr = new Float32Array(planeCr.length);

    for (let iteration = 0; iteration < GAMUT_ITERATIONS; iteration++) {
        clippedCb.fill(0);
        clippedCr.fill(0);
        for (let y = 0; y < BINARY_STRIP_HEIGHT; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                const c = (y >> 1) * chromaWidth + (x >> 1);
                const cb = planeCb[c] - 128;
                const cr = planeCr[c] - 128;
                const r = clampByte(planeY[i] + 1.402 * cr);
                const g = clampByte(planeY[i] - 0.344136 * cb - 0.714136 * cr);
                const b = clampByte(planeY[i] + 1.772 * cb);
                clippedY[i] = 0.299 * r + 0.587 * g + 0.114 * b;
                clippedCb[c] += (-0.168735892 * r - 0.331264108 * g + 0.5 * b + 128) / 4;
                clippedCr[c] += (0.5 * r - 0.418687589 * g - 0.081312411 * b + 128) / 4;
            }
        }
        planeY.set(clippedY);
        planeCb.set(clippedCb);
        planeCr.set(clippedCr);
        constrain(planeY, width, target.luma, BINARY_LUMA_BITS, BINARY_LUMA_STEP);
        constrain(planeCb, chromaWidth, target.cb, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP);
        constrain(planeCr, chromaWidth, target.cr, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP);
    }

    for (let y = 0; y < BINARY_STRIP_HEIGHT; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const c = (y >> 1) * chromaWidth + (x >> 1);
            const cb = planeCb[c] - 128;
            const cr = planeCr[c] - 128;
            const off = ((baseY + y) * width + x) * 4;
            out[off] = Math.round(clampByte(planeY[i] + 1.402 * cr));
            out[off + 1] = Math.round(clampByte(planeY[i] - 0.344136 * cb - 0.714136 * cr));
            out[off + 2] = Math.round(clampByte(planeY[i] + 1.772 * cb));
            out[off + 3] = 255;
        }
    }
}

/** Reads the coefficients of the strip at row `baseY` back from RGBA pixels. */
export function analyzeStrip(data: Uint8ClampedArray, baseY: number): StripCoefficients {
    const width = IMAGE_WIDTH;
    const chromaWidth = width / 2;
    const planeY = new Float32Array(width * BINARY_STRIP_HEIGHT);
    const planeCb = new Float32Array(chromaWidth * (BINARY_STRIP_HEIGHT / 2));
    const planeCr = new Float32Array(chromaWidth * (BINARY_STRIP_HEIGHT / 2));

    for (let y = 0; y < BINARY_STRIP_HEIGHT; y++) {
        for (let x = 0; x < width; x++) {
            const off = ((baseY + y) * width + x) * 4;
            // Rows past the end of a truncated image read as mid-grey
            const r = off < data.length ? data[off] : 128;
            const g = off < data.length ? data[off + 1] : 128;
            const b = off < data.length ? data[off + 2] : 128;
            const c = (y >> 1) * chromaWidth + (x >> 1);
            planeY[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
            planeCb[c] += (-0.168735892 * r - 0.331264108 * g + 0.5 * b) / 4;
            planeCr[c] += (0.5 * r - 0.418687589 * g - 0.081312411 * b) / 4;
        }
    }

    const coefs = createStripCoefficients();
    const spatial = new Float32Array(64);
    const block = new Float32Array(64);
    const temp = new Float32Array(64);
    const transform = (plane: Float32Array, planeWidth: number, dest: Float32Array) => {
        const blocksPerRow = planeWidth / 8;
        const blocks = dest.length / 64;
        for (let index = 0; index < blocks; index++) {
            const bx = (index % blocksPerRow) * 8;
            const by = Math.floor(index / blocksPerRow) * 8;
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    spatial[y * 8 + x] = plane[(by + y) * planeWidth + bx + x];
                }
            }
            dct8x8(spatial, block, temp);
            dest.set(block, index * 64);
        }
    };
    transform(planeY, width, coefs.luma);
    transform(planeCb, chromaWidth, coefs.cb);
    transform(planeCr, chromaWidth, coefs.cr);
    return coefs;
}

/**
 * Estimates the noise on each coefficient position from the distance between
 * the received values and their nearest levels, over all strips of an image.
 */
export function estimateNoise(strips: StripCoefficients[]): NoiseModel {
    const estimate = (pick: (s: StripCoefficients) => Float32Array, bitTable: number[], stepTable: number[]) => {
        const sums = new Float64Array(64);
        let count = 0;
        for (const strip of strips) {
            const plane = pick(strip);
            const blocks = plane.length / 64;
            count += blocks;
            for (let block = 0; block < blocks; block++) {
                for (let k = 0; k < 64; k++) {
                    const half = ((1 << bitTable[k]) - 1) / 2;
                    const position = plane[block * 64 + k] / stepTable[k] + half;
                    const nearest = Math.max(0, Math.min(2 * half, Math.round(position)));
                    const residual = (position - nearest) * stepTable[k];
                    sums[k] += residual * residual;
                }
            }
        }
        return Float32Array.from(sums, s => Math.sqrt(s / Math.max(1, count)) + SIGMA_FLOOR);
    };
    return {
        luma: estimate(s => s.luma, BINARY_LUMA_BITS, BINARY_LUMA_STEP),
        cb: estimate(s => s.cb, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP),
        cr: estimate(s => s.cr, BINARY_CHROMA_BITS, BINARY_CHROMA_STEP)
    };
}

/**
 * Soft-demodulates a strip into one LLR per coded bit, in transmission order.
 * Positive means 0.
 */
export function demodulateStrip(coefs: StripCoefficients, noise: NoiseModel): Float32Array {
    const llrs = new Float32Array(BINARY_STRIP_CODED_BITS);
    const likelihood = new Float64Array(32);
    let bitPos = 0;
    forEachBlock(coefs, (plane, offset, bitTable, stepTable) => {
        const sigmas = plane === coefs.luma ? noise.luma : plane === coefs.cb ? noise.cb : noise.cr;
        for (let k = 0; k < 64; k++) {
            const width = bitTable[k];
            if (width === 0) continue;
            const levels = 1 << width;
            const scale = 1 / (2 * sigmas[k] * sigmas[k]);
            for (let index = 0; index < levels; index++) {
                const distance = plane[offset + k] - (index - (levels - 1) / 2) * stepTable[k];
                const z = distance * distance * scale;
                likelihood[index] = (1 - TAIL_WEIGHT) * Math.exp(-z)
                    + (TAIL_WEIGHT / TAIL_WIDTH) * Math.exp(-z / (TAIL_WIDTH * TAIL_WIDTH)) + 1e-30;
            }
            for (let b = 0; b < width; b++) {
                const mask = 1 << (width - 1 - b);
                let zero = 0;
                let one = 0;
                for (let index = 0; index < levels; index++) {
                    if ((index ^ (index >> 1)) & mask) one += likelihood[index];
                    else zero += likelihood[index];
                }
                llrs[bitPos++] = Math.max(-LLR_LIMIT, Math.min(LLR_LIMIT, Math.log(zero / one)));
            }
        }
    });
    return llrs;
}
