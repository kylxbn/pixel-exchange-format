// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { createRNG } from './rng';
import { crc32c } from './crc32';
import { MurmurHash3_x64_128 } from './murmurHash';
import { floatToHalf, halfToFloat } from './ieee';
import { encodePointToRGB, decodeRGBToPoint, type Vec3 } from './obb';

describe('RNG', () => {
    it('should be deterministic and have reasonable distribution', () => {
        const rng1 = createRNG(12345);
        const rng2 = createRNG(12345);
        const seq1 = Array(10).fill(0).map(() => rng1.nextByte());
        const seq2 = Array(10).fill(0).map(() => rng2.nextByte());
        expect(seq1).toEqual(seq2);

        const rng3 = createRNG(999);
        let sum = 0;
        const count = 1000;
        for (let i = 0; i < count; i++) sum += rng3.nextByte();
        const avg = sum / count;
        expect(avg).toBeGreaterThan(100);
        expect(avg).toBeLessThan(155);
    });
});

describe('CRC32C', () => {
    it('should match known values', () => {
        const values: Array<[string, number]> = [
            ["123456789", 0xE3069283],
            ["", 0],
            ["\0", 0x527D5351],
        ];

        for (const [input, expected] of values) {
            const data = new TextEncoder().encode(input);
            const crc = crc32c(data);
            expect(crc).toBe(expected);
        }
    });
});

describe('MurmurHash3 x64 128-bit', () => {
    const bytesToHex = (bytes: Uint8Array): string => {
        let hex = "";
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i].toString(16).padStart(2, "0");
            hex += b;
        }
        return hex;
    }

    it('should match known hashes', () => {
        const values: Array<[string, string]> = [
            ['', "00000000000000000000000000000000"],
            ['a', "897859f6655555855a890e51483ab5e6"],
            ['abc', "6778ad3f3f3f96b4522dca264174a23b"],
            ["Hello", '1cc4d455ff74b93544551229cfea00a0']
        ];

        for (const [input, expected] of values) {
            const data = new TextEncoder().encode(input);
            const murmur = bytesToHex(MurmurHash3_x64_128.hash(data));
            expect(murmur).toBe(expected);
        }
    });
});

describe('Float16', () => {
    it('should convert back and forth with low error', () => {
        const values = [0, 1.0, -1.0, 123.456, 0.0001, 65504];
        for (const val of values) {
            const half = floatToHalf(val);
            const back = halfToFloat(half);
            const err = Math.abs(val - back);
            const tol = Math.max(0.001, Math.abs(val) * 0.001);
            expect(err).toBeLessThan(tol);
        }
    });

    it('should handle infinity', () => {
        const infHalf = 0x7c00;
        const val = halfToFloat(infHalf);
        expect(val).toBe(Infinity);
    });
});

describe('OBB', () => {
    it('should be reversible within tolerance', () => {
        const dist3 = (a: Vec3, b: Vec3): number => {
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            const dz = a[2] - b[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        const tests: Vec3[] = [
            [0, 0, 0],
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [0.3, -0.5, 0.7],
            [-0.8, 0.2, -0.6]
        ];
        for (const p of tests) {
            let [r, g, b] = encodePointToRGB(p);
            r = Math.round(Math.min(255, Math.max(0, r)));
            g = Math.round(Math.min(255, Math.max(0, g)));
            b = Math.round(Math.min(255, Math.max(0, b)));
            const t = decodeRGBToPoint(r, g, b);
            const distance = dist3(p, t);
            expect(distance).toBeLessThan(0.035);
        }
    });
});
