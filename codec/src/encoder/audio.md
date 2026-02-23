---
order: 14
title: Audio Mode Format
---

Audio mode encodes PCM into 1024px-wide images using MDCT-domain compression, per-row metadata, and deterministic transforms.

## Channel Handling

- Mono uses `channelMode = 0`.
- Stereo is encoded as mid/side image pairs:
  - Mid image: `channelMode = 1`
  - Side image: `channelMode = 2`
  - Pair indexing is deterministic per chunk:
    - mid images use odd `imageIndex` values (`1, 3, 5, ...`)
    - side images use the following even index (`2, 4, 6, ...`)
    - `totalImages` is `2 * numChunks` for stereo
- Mid/side signals are:
  - `mid = (L + R) * 0.5`
  - `side = (L - R) * 0.5`

## Image Layout

- Row 0: header
- Row 1: text/info row
- Rows 2+: audio payload rows

Each payload row has:
- 124 data blocks (one audio block per data block)
- 4 metadata blocks (row metadata, 32 bytes after LDPC)

## Block Pipeline

For each audio block (`hop = 128`, `window = 256`):

1. Apply sine window and compute 128-bin MDCT.
2. Keep bins `0..95` as stored payload coefficients.
3. Keep full 128 bins temporarily for SBR analysis.

Per row, the encoder then:

1. Runs SBR analysis and encodes 8 bytes of row SBR metadata.
2. Applies static MDCT whitening to stored bins `0..95`.
3. Computes subgroup band factors (4 bands over bins `0..63`).
4. Applies subgroup band factors to bins `0..63`.
5. Maps coefficients to:
   - 8x8 luma DCT coefficients (`bins 0..63`)
   - 4x4 chroma DCT coefficients (`bins 64..95`, interleaved Cb/Cr)
6. Runs IDCT to spatial domain.
7. Computes row scaling factors to avoid clipping.
8. Writes pixels via OBB mapping (point space -> YCbCr -> RGB).

## Row Metadata Encoding

Row metadata payload is 28 bytes:

- Bytes `0..7`: SBR row bytes
- Bytes `8..19`: six half-floats (`scaleYA`, `scaleYB`, `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY`)
- Bytes `20..27`: subgroup band factors (`A[4]`, `B[4]`) via log encoding

This 28-byte payload is LDPC-encoded to 32 bytes, whitened with a row-specific seed, and written to the final 4 blocks of the row.

## Multi-Image Chunking

- Audio is chunked by max image height (default 4096px).
- Split points are aligned to MDCT hop boundaries.
- Header fields carry image index and total image count for reassembly.
