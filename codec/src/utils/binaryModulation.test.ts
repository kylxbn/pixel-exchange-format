// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { IMAGE_WIDTH } from '../constants';
import { createRNG } from './rng';
import {
    BINARY_BITS_PER_MCU, BINARY_STRIP_CODED_BITS, BINARY_STRIP_DATA_CAPACITY, BINARY_STRIP_HEIGHT,
    LDPC_BINARY_K, LDPC_BINARY_N,
    analyzeStrip, demodulateStrip, estimateNoise, generateBinaryScrambleMask, modulateStrip, renderStrip,
} from './binaryModulation';
import { getBinaryPermutation } from './shuffle';

function randomBits(seed: number): Uint8Array {
    const rng = createRNG(seed);
    const bits = new Uint8Array(BINARY_STRIP_CODED_BITS);
    for (let i = 0; i < bits.length; i++) bits[i] = rng.nextByte() & 1;
    return bits;
}

describe('Binary modulation', () => {
    it('has a byte-aligned strip layout', () => {
        expect(BINARY_BITS_PER_MCU).toBe(1014);
        expect(LDPC_BINARY_N).toBe(64896);
        expect(LDPC_BINARY_K).toBe(58400);
        expect(BINARY_STRIP_DATA_CAPACITY).toBe(7296);
    });

    it('reads back the bits it wrote', () => {
        const bits = randomBits(1);
        const pixels = new Uint8ClampedArray(IMAGE_WIDTH * BINARY_STRIP_HEIGHT * 4);
        renderStrip(modulateStrip(bits), pixels, 0);

        const coefs = analyzeStrip(pixels, 0);
        const llrs = demodulateStrip(coefs, estimateNoise([coefs]));

        // Fitting the strip into the RGB cube costs a few bits, far below what the code corrects
        let wrong = 0;
        for (let i = 0; i < bits.length; i++) {
            if ((llrs[i] < 0 ? 1 : 0) !== bits[i]) wrong++;
        }
        expect(wrong / bits.length).toBeLessThan(0.001);
    });

    it('keeps coefficients on their symbols when nothing clips', () => {
        // The lowest index of every coefficient is a strong negative level; an
        // all-zero strip is the worst case for the pixel range
        const target = modulateStrip(new Uint8Array(BINARY_STRIP_CODED_BITS));
        expect(target.luma[0]).toBeLessThan(0);

        const bits = randomBits(2);
        const wanted = modulateStrip(bits);
        const pixels = new Uint8ClampedArray(IMAGE_WIDTH * BINARY_STRIP_HEIGHT * 4);
        renderStrip(wanted, pixels, 0);
        const got = analyzeStrip(pixels, 0);

        let squared = 0;
        for (let i = 0; i < wanted.luma.length; i++) squared += (got.luma[i] - wanted.luma[i]) ** 2;
        expect(Math.sqrt(squared / wanted.luma.length)).toBeLessThan(1);
    });

    it('uses a full permutation and a per-strip mask', () => {
        const permutation = getBinaryPermutation();
        expect(permutation.length).toBe(LDPC_BINARY_N);
        const seen = new Uint8Array(LDPC_BINARY_N);
        for (const position of permutation) seen[position]++;
        expect(seen.every(count => count === 1)).toBe(true);

        const maskA = generateBinaryScrambleMask(0);
        const maskB = generateBinaryScrambleMask(1);
        expect(maskA.length).toBe(LDPC_BINARY_N / 8);
        expect(Array.from(maskA)).toEqual(Array.from(generateBinaryScrambleMask(0)));
        expect(Array.from(maskA)).not.toEqual(Array.from(maskB));
    });
});
