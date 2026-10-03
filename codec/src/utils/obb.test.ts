// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { encodePointToRGB, decodeRGBToPoint, Vec3 } from './obb';

describe('Oriented Bounding Box', () => {
    describe('OBB Reversability', () => {
        it('should be reversable', () => {
            for (let x = -1.0; x < 1.0; x += 0.05) {
                for (let y = -1.0; y < 1.0; y += 0.05) {
                    for (let z = -1.0; z < 1.0; z += 0.05) {
                        const origVec: Vec3 = [x, y, z];
                        const [r, g, b] = encodePointToRGB(origVec);
                        const decoded = decodeRGBToPoint(r, g, b);
                        
                        const diff = origVec.map((v, i) => Math.abs(v - decoded[i])).reduce((total, current) => total + current, 0);
                        expect(diff).toBeLessThan(0.0004);
                    }
                    const origVec: Vec3 = [x, y, 1.0];
                    const [r, g, b] = encodePointToRGB(origVec);
                    const decoded = decodeRGBToPoint(r, g, b);
                    
                    const diff = origVec.map((v, i) => Math.abs(v - decoded[i])).reduce((total, current) => total + current, 0);
                    expect(diff).toBeLessThan(0.0004);                    
                }
                const origVec: Vec3 = [x, 1.0, 1.0];
                const [r, g, b] = encodePointToRGB(origVec);
                const decoded = decodeRGBToPoint(r, g, b);
                
                const diff = origVec.map((v, i) => Math.abs(v - decoded[i])).reduce((total, current) => total + current, 0);
                expect(diff).toBeLessThan(0.0004);
            }
            const origVec: Vec3 = [1.0, 1.0, 1.0];
            const [r, g, b] = encodePointToRGB(origVec);
            const decoded = decodeRGBToPoint(r, g, b);
            
            const diff = origVec.map((v, i) => Math.abs(v - decoded[i])).reduce((total, current) => total + current, 0);
            expect(diff).toBeLessThan(0.0004);
        });
    });

    describe('Zero point', () => {
        it('should survive pixel rounding exactly', () => {
            const [r, g, b] = encodePointToRGB([0, 0, 0]).map(Math.round);
            expect([r, g, b]).toEqual([128, 128, 128]);
            expect(Math.abs(decodeRGBToPoint(r, g, b)[0])).toBeLessThan(1e-12);
        });

        it('should stay within pixel rounding of the RGB range', () => {
            for (const x of [-1, 1]) {
                for (const y of [-1, 1]) {
                    for (const z of [-1, 1]) {
                        for (const c of encodePointToRGB([x, y, z])) {
                            expect(c).toBeGreaterThan(-0.5);
                            expect(c).toBeLessThan(255.5);
                        }
                    }
                }
            }
        });
    });
});
