// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { mdct, imdct, getSineWindow} from './audioUtils';
import { floatToHalf, halfToFloat } from './ieee';

describe('Audio Utils', () => {

    describe('MDCT / IMDCT', () => {
        it('should handle non-optimized sizes via fallback', () => {
            const size = 64; // Not 128 (default optimized)
            const input = new Float32Array(size);
            for (let i = 0; i < size; i++) input[i] = Math.cos(i / 10);

            const coeffs = mdct(input);
            expect(coeffs.length).toBe(size / 2); // N = len/2

            const output = imdct(coeffs);
            expect(output.length).toBe(size);
        });

        it('getSineWindow should support custom size', () => {
            const w = getSineWindow(64);
            expect(w.length).toBe(64);
            expect(w[0]).toBeCloseTo(Math.sin(Math.PI * 0.5 / 64));
        });
    });

    describe('Float16 Extended', () => {
        it('should handle NaN', () => {
            const half = floatToHalf(NaN);
            const back = halfToFloat(half);
            expect(Number.isNaN(back)).toBe(true);
        });

        it('should handle subnormal numbers correctly', () => {
            // Smallest normalized float16 is 2^-14 ~= 6.10e-5
            // Create a number smaller than that
            const val = 1.0e-6; // Subnormal for half
            const h = floatToHalf(val);
            const back = halfToFloat(h);

            expect(back).toBeCloseTo(val, 5);
            // Check that exponent bits are 0 for subnormal
            const e = (h & 0x7c00) >> 10;
            expect(e).toBe(0);
        });
    });
});
