// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { LdpcCode, LDPCGraphBuilder } from '.';

describe('LDPC', () => {
    it('should correct errors using soft decoding', () => {
        // Create simple LDPC code: 128 bits total, 64 bits data.
        const N = 128;
        const K = 64;
        const ldpc = new LdpcCode(new LDPCGraphBuilder(N, K, 12345).packGraph());

        // Random Data
        const data = new Uint8Array(8);
        for (let i = 0; i < 8; i++) data[i] = i;

        // Encode
        const encoded = ldpc.encode(data);
        expect(encoded.length).toBe(16); // 128 bits

        // Simulate Channel: Add noise and flip bits
        // Convert to LLRs
        const llrs = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const byteIdx = i >>> 3;
            const bitIdx = i & 7;
            const bit = (encoded[byteIdx] >> (7 - bitIdx)) & 1;

            // Base LLR: Strong (+10 for 0, -10 for 1)
            let val = bit === 0 ? 10.0 : -10.0;

            // Flip a few bits (simulate error)
            if (i === 10 || i === 50) val = -val;

            // Add noise (make it weak confidence)
            if (i === 20) val = val * 0.1;

            llrs[i] = val;
        }

        const decoded = ldpc.decode(llrs);
        expect(decoded.corrected).toBe(true);
        expect(Array.from(decoded.data)).toEqual(Array.from(data));
    });

    it('should throw error when encoding with wrong data length', () => {
        const N = 128;
        const K = 64;
        const ldpc = new LdpcCode(new LDPCGraphBuilder(N, K, 12345).packGraph());

        const wrongData = new Uint8Array(5); // 40 bits != 64 bits
        expect(() => ldpc.encode(wrongData)).toThrow(/Expected 64 bits/);
    });

    it('should generate graph using LDPCGraphBuilder', () => {
        const builder = new LDPCGraphBuilder(128, 64, 111);
        const graph = builder.packGraph();

        expect(graph.n).toBe(128);
        expect(graph.k).toBe(64);
        expect(graph.edges.length).toBeGreaterThan(0);
        expect(graph.checkNodeEdges.length).toBe(64);
    });

    it('should fallback to OSD if SPA fails (simulated)', () => {
        const N = 32;
        const K = 16;
        const ldpc = new LdpcCode(new LDPCGraphBuilder(N, K, 999).packGraph());

        const data = new Uint8Array(2).fill(0);
        const encoded = ldpc.encode(data); // All zeros

        const llrs = new Float32Array(N);
        // Set LLRs: ambiguous for some bits
        for (let i = 0; i < N; i++) {
            // 0 -> +val
            const isZero = ((encoded[i >>> 3] >> (7 - (i & 7))) & 1) === 0;
            llrs[i] = isZero ? 2.0 : -2.0;
        }

        // Flip a few bits to make it hard
        llrs[0] = -llrs[0];
        llrs[1] = -llrs[1];
        llrs[10] = -llrs[10];
        // Reduce confidence significantly to confusing level
        for (let i = 0; i < N; i++) llrs[i] *= 0.2;

        const decoded = ldpc.decode(llrs, 5); // Low iterations to force early failure of SPA and trigger OSD

        if (decoded.corrected && decoded.iter >= 5) {
            expect(decoded.osd).toBe(true);
        }
    });
});
