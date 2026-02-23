// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export class MurmurHash3_x64_128 {
    private static C1 = 0x87c37b91114253d5n;
    private static C2 = 0x4cf5ad432745937fn;

    public static hash(data: Uint8Array, seed = 0): Uint8Array {
        let h1 = BigInt(seed);
        let h2 = BigInt(seed);

        const len = BigInt(data.length);
        const bytes = data.length & ~15; // round down to nearest 16

        let i = 0;

        // ---- Process 16-byte blocks ----
        while (i < bytes) {
            const k1 =
                BigInt(data[i + 0]) |
                (BigInt(data[i + 1]) << 8n) |
                (BigInt(data[i + 2]) << 16n) |
                (BigInt(data[i + 3]) << 24n) |
                (BigInt(data[i + 4]) << 32n) |
                (BigInt(data[i + 5]) << 40n) |
                (BigInt(data[i + 6]) << 48n) |
                (BigInt(data[i + 7]) << 56n);

            const k2 =
                BigInt(data[i + 8]) |
                (BigInt(data[i + 9]) << 8n) |
                (BigInt(data[i + 10]) << 16n) |
                (BigInt(data[i + 11]) << 24n) |
                (BigInt(data[i + 12]) << 32n) |
                (BigInt(data[i + 13]) << 40n) |
                (BigInt(data[i + 14]) << 48n) |
                (BigInt(data[i + 15]) << 56n);

            let kk1 = k1;
            let kk2 = k2;

            kk1 = (kk1 * this.C1) & 0xffffffffffffffffn;
            kk1 = this.rotl64(kk1, 31n);
            kk1 = (kk1 * this.C2) & 0xffffffffffffffffn;
            h1 ^= kk1;

            h1 = this.rotl64(h1, 27n);
            h1 = (h1 + h2) & 0xffffffffffffffffn;
            h1 = (h1 * 5n + 0x52dce729n) & 0xffffffffffffffffn;

            kk2 = (kk2 * this.C2) & 0xffffffffffffffffn;
            kk2 = this.rotl64(kk2, 33n);
            kk2 = (kk2 * this.C1) & 0xffffffffffffffffn;
            h2 ^= kk2;

            h2 = this.rotl64(h2, 31n);
            h2 = (h2 + h1) & 0xffffffffffffffffn;
            h2 = (h2 * 5n + 0x38495ab5n) & 0xffffffffffffffffn;

            i += 16;
        }

        // ---- Tail ----
        let k1 = 0n;
        let k2 = 0n;
        const rem = data.length & 15;

        for (let t = rem - 1; t >= 0; t--) {
            const b = BigInt(data[i + t]);
            if (t >= 8) {
                k2 |= b << BigInt((t - 8) * 8);
            } else {
                k1 |= b << BigInt(t * 8);
            }
        }

        if (rem > 8) {
            k2 = (k2 * this.C2) & 0xffffffffffffffffn;
            k2 = this.rotl64(k2, 33n);
            k2 = (k2 * this.C1) & 0xffffffffffffffffn;
            h2 ^= k2;
        }

        if (rem > 0) {
            k1 = (k1 * this.C1) & 0xffffffffffffffffn;
            k1 = this.rotl64(k1, 31n);
            k1 = (k1 * this.C2) & 0xffffffffffffffffn;
            h1 ^= k1;
        }

        // ---- Finalization ----
        h1 ^= len;
        h2 ^= len;

        h1 = (h1 + h2) & 0xffffffffffffffffn;
        h2 = (h2 + h1) & 0xffffffffffffffffn;

        h1 = this.fmix64(h1);
        h2 = this.fmix64(h2);

        h1 = (h1 + h2) & 0xffffffffffffffffn;
        h2 = (h2 + h1) & 0xffffffffffffffffn;

        // Output as Uint8Array(16), little endian
        const out = new Uint8Array(16);
        this.write64LE(out, 0, h1);
        this.write64LE(out, 8, h2);
        return out;
    }

    // ---- Helpers ----

    private static rotl64(x: bigint, r: bigint) {
        return ((x << r) | (x >> (64n - r))) & 0xffffffffffffffffn;
    }

    private static fmix64(h: bigint) {
        h ^= h >> 33n;
        h = (h * 0xff51afd7ed558ccdn) & 0xffffffffffffffffn;
        h ^= h >> 33n;
        h = (h * 0xc4ceb9fe1a85ec53n) & 0xffffffffffffffffn;
        h ^= h >> 33n;
        return h;
    }

    private static write64LE(out: Uint8Array, offset: number, v: bigint) {
        for (let i = 0; i < 8; i++) {
            out[offset + i] = Number((v >> BigInt(i * 8)) & 0xffn);
        }
    }
}
