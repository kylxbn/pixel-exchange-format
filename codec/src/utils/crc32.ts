// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

const CRC32C_POLY = 0x82F63B78;
const CRC32C_TABLE = new Uint32Array(256);

// Precompute table
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (CRC32C_POLY ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32C_TABLE[i] = c >>> 0;
}

export function crc32c(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
