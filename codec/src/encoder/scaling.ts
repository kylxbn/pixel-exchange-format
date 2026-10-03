// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { SILENCE_THRESHOLD } from '../constants';
import { isLumaSubgroupA } from '../audioLayout';

export class ScalingUtils {
    /**
     * Calculate luma scaling factors for a row of spatial data.
     * Chroma scales are computed at row-pair level (prepareRowPairChroma).
     */
    public static calculateLumaScalingFactors(
        rowSpatialY: Float32Array,
        rowDataCount: number
    ): { scaleYA: number; scaleYB: number } {
        let maxLumaA = 0;
        let maxLumaB = 0;

        for (let i = 0; i < rowDataCount; i++) {
            const spatialOffsetY = i * 64;
            const isA = isLumaSubgroupA(i);

            for (let j = 0; j < 64; j++) {
                const val = Math.abs(rowSpatialY[spatialOffsetY + j]);
                if (isA) {
                    maxLumaA = Math.max(maxLumaA, val);
                } else {
                    maxLumaB = Math.max(maxLumaB, val);
                }
            }
        }

        const scaleYA = maxLumaA > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxLumaA) : 65504;
        const scaleYB = maxLumaB > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / maxLumaB) : 65504;

        return { scaleYA, scaleYB };
    }
}
