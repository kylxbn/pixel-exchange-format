// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { mdct, imdct } from './audioUtils';
import { dct8x8, idct8x8 } from './audioUtils';

describe('DSP', () => {
    it('MDCT Structure & Output', () => {
        const N = 64;
        const windowSize = 128;
        const input = new Float32Array(windowSize);
        for (let i = 0; i < windowSize; i++) input[i] = Math.sin(i * 0.1);

        const coeffs = mdct(input);
        const reconstructed = imdct(coeffs);

        expect(coeffs.length).toBe(N);
        expect(reconstructed.length).toBe(windowSize);
        expect(isNaN(coeffs[0])).toBe(false);
    });

    it('DCT 8x8 Invertibility', () => {
        const src = new Float32Array(64);
        for (let i = 0; i < 64; i++) src[i] = i;

        const dest = new Float32Array(64);
        const temp = new Float32Array(64);

        dct8x8(src, dest, temp);

        const recon = new Float32Array(64);
        idct8x8(dest, recon, temp);

        for (let i = 0; i < 64; i++) {
            expect(Math.abs(src[i] - recon[i])).toBeLessThan(1e-5);
        }
    });
});
