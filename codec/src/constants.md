---
order: 1
title: Format Constants
---

PXF v300 uses fixed constants shared by encoder and decoder implementations.

## Image and Row Layout

- `IMAGE_WIDTH = 1024`
- `BLOCK_SIZE = 8`
- `BLOCKS_PER_ROW = 128`
- `DATA_BLOCKS_PER_ROW = 124`
- `META_BLOCKS_PER_ROW = 4`
- `BYTES_PER_BLOCK = 8` for 1-bit block streams (header + metadata)

Rows are laid out as:
- Row 0: LDPC-protected header stream
- Row 1: text/info row (plus header checksums in last 4 blocks)
- Rows 2+: audio or binary data rows

## Header Constants

- `HEADER_TOTAL_BYTES = 1024`
- `HEADER_PAYLOAD_BYTES = 768`
- `HEADER_FIXED_BYTES = 21`
- `MAX_STRING_DATA_BYTES = 747`

Header LDPC uses:
- `N = 8192`
- `K = 6144`

## Audio Constants

- `MDCT_HOP_SIZE = 128`
- `MDCT_WINDOW_SIZE = 256`
- Stored coefficients per block: 96 (64 luma + 32 chroma-interleaved)
- SBR reconstructs bins `96..127`

Row metadata:
- `ROW_META_TOTAL_BYTES = 32`
- `ROW_META_PAYLOAD_BYTES = 28`
- `ROW_META_SBR_BYTES = 8`
- `ROW_META_AUDIO_BYTES = 20`

Subgroup constants:
- `SUBGROUP_A_SIZE = 62` (A/B split per row)
- `SUBGROUP_X_SIZE = 31` (X/Y split inside each half)

Band mapping for bins `0..63`:
- Band 0: bins `0..2`
- Band 1: bins `3..8`
- Band 2: bins `9..24`
- Band 3: bins `25..63`

## Binary Constants

Binary blocks are 4:2:0 YCbCr-mapped:
- `BINARY_BYTES_PER_BLOCK = 20`
- Per block: 16 bytes Y (2-bit symbols) + 2 bytes Cb (1-bit) + 2 bytes Cr (1-bit)

Per row:
- `BINARY_ROW_DATA_CAPACITY = 2480`
- `BINARY_ROW_META_BYTES = 32`
- `BINARY_ROW_PARITY_BYTES = 28`
- `BINARY_ROW_CRC_BYTES = 4`

Binary LDPC:
- `LDPC_BINARY_K = 19840`
- `LDPC_BINARY_N = 20064`

## Protocol and Seeds

- `FORMAT_VERSION = 300`

Channel modes:
- `0`: mono
- `1`: stereo mid
- `2`: stereo side
- `3`: binary

Whitening/permutation seeds:
- `HEADER_XOR_MASK_SEED = 0xe5b4d3bd`
- `ROW_META_XOR_SEED_BASE = 0xc4396125`
- `BINARY_PERMUTATION_SEED = 0xbf4d0153`

## Coefficient Orders and Mu-Law

Implemented scan orders:
- `ZIGZAG_8X8_FLAT`
- `ZIGZAG_4X4_FLAT`
- `RASTER_8X8_FLAT`
- `RASTER_4X4_FLAT`

Band-map assignment and active pixel scan selection are configured in `psychoacoustics.ts`:
- `AUDIO_PSYCHOACOUSTICS.bandMap`
- `AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8`
- `AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4`

Mu-law values and audio stage toggles are configured in `psychoacoustics.ts`:
- `AUDIO_PSYCHOACOUSTICS.muLaw.luma`
- `AUDIO_PSYCHOACOUSTICS.muLaw.chromaCb`
- `AUDIO_PSYCHOACOUSTICS.muLaw.chromaCr`

## Misc

- `SILENCE_THRESHOLD = 1e-9`
- Default max image area in chunking path is `1024 * 4096 = 4,194,304` pixels
