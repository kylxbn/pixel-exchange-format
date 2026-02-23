// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { LdpcCode } from "./ldpc";
import type { LDPCGraphData } from "./ldpc";
import {
    AUDIO_PSYCHOACOUSTICS,
    RASTER_4X4_FLAT,
    RASTER_8X8_FLAT,
    ZIGZAG_4X4_FLAT,
    ZIGZAG_8X8_FLAT
} from './psychoacoustics';

// // --- Physical & Algorithmic Constants ---

export const BLOCK_SIZE = 8;
export const MDCT_HOP_SIZE = 128; // MDCT hop size for SBR (128 bins total, 96 stored + 32 analyzed for SBR)
export const MDCT_WINDOW_SIZE = MDCT_HOP_SIZE * 2; // 256
export const IMAGE_WIDTH = 1024;

// // --- Layout Constants ---

export const BLOCKS_PER_ROW = IMAGE_WIDTH / BLOCK_SIZE; // 128
export const META_BLOCKS_PER_ROW = 4;
export const DATA_BLOCKS_PER_ROW = BLOCKS_PER_ROW - META_BLOCKS_PER_ROW; // 124

// // Header Layout (LDPC Stream)
// // The header is now one continuous stream of data + parity.
// // Total capacity: 128 blocks * 8 bytes = 1024 bytes.
export const HEADER_ROW_BLOCKS = IMAGE_WIDTH / BLOCK_SIZE;
export const BYTES_PER_BLOCK = (BLOCK_SIZE * BLOCK_SIZE) / 8;
export const HEADER_TOTAL_BYTES = HEADER_ROW_BLOCKS * BYTES_PER_BLOCK; // 1024

// // LDPC Params for Header (Stream Mode)
// // We use the full row. 
export const HEADER_PAYLOAD_BYTES = 768; // Data

// // The header metadata (fixed integers).
// // Version (2) + SampleRate (4) + TotalSamples (4) + StringLen (2) + ChannelMode (1) + Random (4) + ImageIndex (2) + TotalImages (2)
export const HEADER_FIXED_BYTES = 21;

// // Default max string bytes
export const MAX_STRING_DATA_BYTES = HEADER_PAYLOAD_BYTES - HEADER_FIXED_BYTES; // 747

// // Row Metadata Layout (LDPC)
// // Blocks 124-127 have 256 pixels -> 256 bits -> 32 bytes capacity
export const ROW_META_TOTAL_BYTES = 32;

// // Payload Update:
// // 8 bytes SBR + 20 bytes Audio Meta = 28 bytes Payload
export const ROW_META_AUDIO_BYTES = 20;
export const ROW_META_SBR_BYTES = 8;
export const ROW_META_PAYLOAD_BYTES = ROW_META_SBR_BYTES + ROW_META_AUDIO_BYTES; // 28

// // A row is split into two subgroups for adaptive quantization
export const SUBGROUP_A_SIZE = 62;
export const SUBGROUP_X_SIZE = 31;

// // --- Binary Mode Constants (Stream Mode) ---
export const BINARY_DATA_BLOCKS_PER_ROW = 124;
export const BINARY_BYTES_PER_BLOCK = 20; // 160 bits: 128 bits Y (64 pixels * 2) + 16 bits Cb (16 pixels) + 16 bits Cr (16 pixels)
export const BINARY_ROW_DATA_CAPACITY = BINARY_DATA_BLOCKS_PER_ROW * BINARY_BYTES_PER_BLOCK; // 2480 bytes

// // Binary Row Metadata: 4 blocks = 256 pixels = 256 bits = 32 bytes
export const BINARY_ROW_META_BYTES = 32;

// // Parity allocation for Binary Stream:
// // We have 32 bytes metadata. 4 bytes are CRC32.
// // Remaining 28 bytes are used for LDPC Parity.
export const BINARY_ROW_PARITY_BYTES = 28;
export const BINARY_ROW_CRC_BYTES = 4;

// // LDPC Params for Binary Stream
export const LDPC_BINARY_K = BINARY_ROW_DATA_CAPACITY * 8; // 19840
export const LDPC_BINARY_N = (BINARY_ROW_DATA_CAPACITY + BINARY_ROW_PARITY_BYTES) * 8; // 20064

// Backward-compatible aliases; source of truth lives in psychoacoustics.ts
export const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;
export { ZIGZAG_4X4_FLAT, RASTER_4X4_FLAT, ZIGZAG_8X8_FLAT, RASTER_8X8_FLAT };

// // --- Protocol & Format Identifiers ---

export const FORMAT_VERSION = 300;
export const HEADER_XOR_MASK_SEED = 0xe5b4d3bd; // SHA256("PXF:v300:Main header whitening seed")[0:4]
export const ROW_META_XOR_SEED_BASE = 0xc4396125; // SHA256("PXF:v300:Audio row metadata whitening seed")[0:4]
export const BINARY_PERMUTATION_SEED = 0xbf4d0153; // SHA256("PXF:v300:Binary mode byte pair permutation seed")[0:4]

// // Seeds for LDPC Matrix Generation (ensures decoder matches encoder)
// export const LDPC_SEED_HEADER = 0x46a11d63; // SHA256("PXF:v300:Binary mode byte pair permutation seed")[0:4]
// export const LDPC_SEED_ROWMETA = 0x90a1d73b; // SHA256("PXF:v300:LDPC audio row metadata seed")[0:4]
// export const LDPC_SEED_BINARY = 0xc6421d38; // SHA256("PXF:v300:LDPC binary row metadata seed")[0:4]

export const CHANNEL_MODE = {
    MONO: 0,
    STEREO_MID: 1,
    STEREO_SIDE: 2,
    BINARY: 3
};

import headerGraphJson from './ldpc/graph_8192_6144_1184963939.json';
import rowMetaGraphJson from './ldpc/graph_256_224_2426525499.json';
import binaryGraphJson from './ldpc/graph_20064_19840_3326221624.json';

// // Instantiate Codecs once using pre-calculated graphs or on-the-fly generation as fallback
const headerLdpcGraph: LDPCGraphData = (headerGraphJson as any);
const rowMetaLdpcGraph: LDPCGraphData = (rowMetaGraphJson as any);
const binaryLdpcGraph: LDPCGraphData = (binaryGraphJson as any);

export const headerLdpc: LdpcCode = new LdpcCode(headerLdpcGraph);
export const rowMetaLdpc: LdpcCode = new LdpcCode(rowMetaLdpcGraph);
export const binaryLdpc: LdpcCode = new LdpcCode(binaryLdpcGraph);

export const SILENCE_THRESHOLD: number = 1e-9;
