// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

function splitmix64(seed: bigint): bigint {
    let z = (seed + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
    z = (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n & 0xFFFFFFFFFFFFFFFFn;
    z = (z ^ (z >> 27n)) * 0x94D049BB133111EBn & 0xFFFFFFFFFFFFFFFFn;
    return z ^ (z >> 31n);
}

export class XorShift128Plus {
    private s0: bigint;
    private s1: bigint;

    public constructor(s0: bigint, s1: bigint) {
        if ((s0 | s1) === 0n) s1 = 1n; // avoid all-zero state
        this.s0 = s0;
        this.s1 = s1;
    }

    public next64(): bigint {
        let x = this.s0;
        const y = this.s1;
        this.s0 = y;

        x ^= x << 23n;
        x &= 0xFFFFFFFFFFFFFFFFn;

        this.s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n);
        this.s1 &= 0xFFFFFFFFFFFFFFFFn;

        return (this.s1 + y) & 0xFFFFFFFFFFFFFFFFn;
    }

    public next32(): number {
        return Number((this.next64() >> 32n) & 0xFFFFFFFFn);
    }

    public nextByte(): number {
        return Number((this.next64() >> 56n) & 0xFFn);
    }
}

export function createRNG(seed32: number) {
    const seed = BigInt(seed32 >>> 0);
    const s0 = splitmix64(seed);
    const s1 = splitmix64(s0);
    return new XorShift128Plus(s0, s1);
}
