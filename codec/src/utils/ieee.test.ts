// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { floatToHalf, halfToFloat } from './ieee';

// Helper to visualize bits in failure logs
const toHex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

describe('IEEE 754 Half-Precision (Binary16)', () => {

    describe('Standard Values', () => {
        it('should handle basic integers', () => {
            expect(floatToHalf(0)).toBe(0x0000);
            expect(floatToHalf(1)).toBe(0x3C00);
            expect(floatToHalf(2)).toBe(0x4000);
            expect(floatToHalf(3)).toBe(0x4200);
        });

        it('should handle negative numbers', () => {
            expect(floatToHalf(-1)).toBe(0xBC00);
            expect(floatToHalf(-2)).toBe(0xC000);
        });

        it('should handle signed zeros', () => {
            // 0 is 0x0000
            expect(floatToHalf(0)).toBe(0x0000);
            // -0 is 0x8000
            expect(floatToHalf(-0)).toBe(0x8000);
            
            // Verify round trip for signed zero
            expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
        });
    });

    describe('Special Values (Inf/NaN)', () => {
        it('should handle Infinity', () => {
            expect(floatToHalf(Infinity)).toBe(0x7C00);
            expect(floatToHalf(-Infinity)).toBe(0xFC00);
        });

        it('should handle NaN', () => {
            const result = floatToHalf(NaN);
            // NaN in half float is exponent all 1s (0x7C00 mask) and non-zero mantissa
            const isNaN = (result & 0x7C00) === 0x7C00 && (result & 0x03FF) !== 0;
            expect(isNaN).toBe(true);
            
            // Check that we return NaN when decoding
            expect(halfToFloat(result)).toBeNaN();
        });
    });

    describe('Rounding: Nearest, Ties to Even', () => {
        // 1.0 is 0x3C00. The next representable float is 0x3C01.
        // The gap (epsilon) at 1.0 is 2^-10 (approx 0.0009765625).
        
        it('should round to nearest (standard)', () => {
            // 1.0 + 0.3 * epsilon -> closer to 1.0 (0x3C00)
            expect(floatToHalf(1.00029)).toBe(0x3C00);
            
            // 1.0 + 0.7 * epsilon -> closer to 1.0 + epsilon (0x3C01)
            expect(floatToHalf(1.00068)).toBe(0x3C01);
        });

        it('should handle Tie to Even (Rounding Down case)', () => {
            // We are exactly halfway between 0x3C00 (mantissa 0 -> Even) and 0x3C01 (mantissa 1 -> Odd).
            // Rule: Pick the Even one (0x3C00).
            // Input: 1.0 + (2^-11) = 1.00048828125
            expect(floatToHalf(1.00048828125)).toBe(0x3C00);
        });

        it('should handle Tie to Even (Rounding Up case)', () => {
            // We are exactly halfway between 0x3C01 (Odd) and 0x3C02 (Even).
            // Rule: Pick the Even one (0x3C02).
            // Input: 0x3C01 value + (2^-11) 
            // 1.0009765625 + 0.00048828125 = 1.00146484375
            expect(floatToHalf(1.00146484375)).toBe(0x3C02);
        });
    });

    describe('Mantissa Overflow Handling', () => {
        it('should correctly handle the 1.999... edge case', () => {
            const val = 1.9995745133749991;
            expect(toHex(floatToHalf(val))).toBe(toHex(0x4000));
        });

        it('should handle overflow from Max Subnormal to Min Normal', () => {
            // Max subnormal is 0x03FF. Min Normal is 0x0400.
            // A number halfway between them should round to 0x0400 (Even).
            const maxSub = 6.097555160522461e-5;
            const minNorm = 6.103515625e-5;
            const mid = (maxSub + minNorm) / 2; // Exact midpoint
            
            expect(floatToHalf(mid)).toBe(0x0400); 
        });

        it('should handle overflow from Max Finite to Infinity', () => {
            // Max Float16 is 65504 (0x7BFF).
            // If we go slightly above the rounding threshold, it becomes Infinity (0x7C00).
            expect(floatToHalf(65504 + 16)).toBe(0x7C00); // Infinity
            expect(floatToHalf(65504 + 15)).toBe(0x7BFF); // Still Max Float
        });
    });

    describe('Subnormal Numbers', () => {
        it('should handle smallest positive subnormal', () => {
            // 2^-24
            const smallest = 5.960464477539063e-8;
            expect(floatToHalf(smallest)).toBe(0x0001);
        });

        it('should flush very small numbers to zero', () => {
            // 2^-25 (Too small for half precision subnormal)
            const tooSmall = 2.9802322387695312e-8;
            expect(floatToHalf(tooSmall)).toBe(0x0000);
        });
        
        it('should round correctly within subnormal range', () => {
            // Test rounding logic when exponent is 0
            const smallest = 5.960464477539063e-8; // 0x0001
            // 1.5 * smallest -> rounds to 0x0002 (Even)
            expect(floatToHalf(smallest * 1.5)).toBe(0x0002);
            // 0.5 * smallest -> rounds to 0x0000 (Even)
            expect(floatToHalf(smallest * 0.5)).toBe(0x0000);
            // 0.51 * smallest -> rounds to 0x0001
            expect(floatToHalf(smallest * 0.51)).toBe(0x0001);
        });
    });

    describe('Round Trip Stability', () => {
        // This iterates all "Normal" numbers in Float16 space to ensure consistency.
        it('should maintain value across float -> half -> float', () => {
            // We skip NaNs (comparisons fail) and Subnormals (JS double precision quirks can 
            // make exact round-tripping strict equality tricky due to double-rounding, 
            // though normalized numbers should be perfect).
            
            let errors = 0;
            // Iterate all positive normalized numbers
            // 0x0400 (Min Normal) to 0x7BFF (Max Normal)
            for (let h = 0x0400; h <= 0x7BFF; h++) {
                const f = halfToFloat(h);
                const h2 = floatToHalf(f);
                
                if (h !== h2) {
                    console.error(`Mismatch: Start(0x${h.toString(16)}) -> Float(${f}) -> End(0x${h2.toString(16)})`);
                    errors++;
                    if (errors > 5) break;
                }
            }
            expect(errors).toBe(0);
        });
    });
});