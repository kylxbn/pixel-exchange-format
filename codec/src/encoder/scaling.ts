// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { SILENCE_THRESHOLD, SUBGROUP_A_SIZE, SUBGROUP_X_SIZE } from '../constants';

export class ScalingUtils {
    /**
     * Calculate scaling factors for a row of spatial data to ensure no clipping.
     * Uses max-based scaling to prevent values from exceeding the representable range.
     */
    public static calculateRowScalingFactors(
        rowSpatialY: Float32Array,
        rowSpatialCb: Float32Array,
        rowSpatialCr: Float32Array,
        rowDataCount: number
    ): {
        scaleYA: number;
        scaleYB: number;
        scaleCAX: number;
        scaleCAY: number;
        scaleCBX: number;
        scaleCBY: number;
    } {
        // Accumulate maxes for luma and chroma across all blocks in the row
        let maxLumaA = 0;
        let maxLumaB = 0;
        let maxChromaAX = 0;
        let maxChromaAY = 0;
        let maxChromaBX = 0;
        let maxChromaBY = 0;

        for (let i = 0; i < rowDataCount; i++) {
            // Get spatial data for this block
            const spatialOffsetY = i * 64;
            const spatialOffsetC = i * 16;

            const blockSpatialY = rowSpatialY.subarray(spatialOffsetY, spatialOffsetY + 64);
            const blockSpatialCb = rowSpatialCb.subarray(spatialOffsetC, spatialOffsetC + 16);
            const blockSpatialCr = rowSpatialCr.subarray(spatialOffsetC, spatialOffsetC + 16);

            const isA = i < SUBGROUP_A_SIZE;
            const isX = (i % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;

            // Find absolute max for luma and chroma
            if (isA) {
                for (let j = 0; j < 64; j++) {
                    maxLumaA = Math.max(maxLumaA, Math.abs(blockSpatialY[j]));
                }
                if (isX) {
                    for (let j = 0; j < 16; j++) {
                        maxChromaAX = Math.max(maxChromaAX, Math.abs(blockSpatialCb[j]), Math.abs(blockSpatialCr[j]));
                    }
                } else {
                    for (let j = 0; j < 16; j++) {
                        maxChromaAY = Math.max(maxChromaAY, Math.abs(blockSpatialCb[j]), Math.abs(blockSpatialCr[j]));
                    }
                }
            } else {
                for (let j = 0; j < 64; j++) {
                    maxLumaB = Math.max(maxLumaB, Math.abs(blockSpatialY[j]));
                }
                if (isX) {
                    for (let j = 0; j < 16; j++) {
                        maxChromaBX = Math.max(maxChromaBX, Math.abs(blockSpatialCb[j]), Math.abs(blockSpatialCr[j]));
                    }
                } else {
                    for (let j = 0; j < 16; j++) {
                        maxChromaBY = Math.max(maxChromaBY, Math.abs(blockSpatialCb[j]), Math.abs(blockSpatialCr[j]));
                    }
                }
            }
        }

        // Use max-based scaling to ensure NO clipping
        // Cap at 65504 to prevent half-float overflow
        const scaleYA = maxLumaA > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxLumaA) : 65504;
        const scaleYB = maxLumaB > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxLumaB) : 65504;
        const scaleCAX = maxChromaAX > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxChromaAX) : 65504;
        const scaleCAY = maxChromaAY > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxChromaAY) : 65504;
        const scaleCBX = maxChromaBX > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxChromaBX) : 65504;
        const scaleCBY = maxChromaBY > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxChromaBY) : 65504;

        return {
            scaleYA,
            scaleYB,
            scaleCAX,
            scaleCAY,
            scaleCBX,
            scaleCBY
        };
    }
}
