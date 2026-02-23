// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

// Gentle mu-law companding for floating-point coefficients.

export interface MuLawOptions {
    mu: number;
    decodeSlopeLimit?: number;
}

export class MuLaw {
    public static encode(x: number, mu: number): number {
        if (mu === 0) return x;
        const s = Math.sign(x);
        const ax = Math.abs(x);

        const y = s * Math.log1p(mu * ax) / Math.log1p(mu);

        return y;
    }

    public static decode(y: number, mu: number): number {
        if (mu === 0) return y;
        const s = Math.sign(y);
        const ay = Math.abs(y);

        return s * (Math.expm1(ay * Math.log1p(mu)) / mu);
    }
}
