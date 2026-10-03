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

An audio row is 124 consecutive audio blocks described by one row metadata record. Audio row `R` always has its metadata in image block row `2 + R`.

### Block Order

Audio blocks are stored in JPEG 4:2:0 MCU order. Image rows are used in pairs; the data area of a pair is 62 MCUs of 2x2 blocks (16x16 px). The first audio row of a pair fills the left 31 MCUs and the second fills the right 31, so time runs left to right across the pair. Inside an MCU the four blocks are consecutive in time: top-left, top-right, bottom-left, bottom-right.

For audio row `R` and block `i` (`0..123`):
- `mcu = (R & 1) * 31 + floor(i / 4)`, `ordinal = i % 4`
- image block row `= 2 + (R & ~1) + (ordinal >> 1)`
- image block column `= 2 * mcu + (ordinal & 1)`

Each MCU therefore holds four consecutive audio blocks and one shared 8x8 Cb and Cr block, exactly as a 4:2:0 JPEG encoder scans it.

## Lead-In Block

An MDCT hop is only reconstructed correctly where two windows overlap, and the first hop of a file would have just one. The first image of a file (`imageIndex = 1`, plus the side image `imageIndex = 2` for stereo) therefore stores one extra block ahead of the audio: 128 samples of silence are prepended before MDCT framing, so stored block 0 covers samples `-128..127` and stored block `n + 1` is the block that starts at audio sample `128 * n`.

- The header sample count is the number of real audio samples and does not include the lead-in.
- Such an image stores `ceil((samples + 128) / 128)` blocks; every other image stores `ceil(samples / 128)`.
- Decoders overlap-add as usual and drop the first 128 output samples.

## Block Pipeline

For each audio block (`hop = 128`, `window = 256`):

1. Apply sine window and compute 128-bin MDCT.
2. Keep bins `0..95` as stored payload coefficients.
3. Keep full 128 bins temporarily for SBR analysis.

Per row, the encoder then:

1. Applies static MDCT whitening to stored bins `0..95`.
2. Computes subgroup band factors (4 bands over bins `0..63`).
3. Applies subgroup band factors to bins `0..63`.
4. Maps coefficients to:
   - 8x8 luma DCT coefficients (`bins 0..63`), one block per audio block
   - 8x8 chroma DCT coefficients (`bins 64..95`, interleaved Cb/Cr), one block shared by the four audio blocks of an MCU
5. Runs IDCT to spatial domain.
6. Computes row scaling factors to avoid clipping (see Row Scaling Strategy).
7. Writes pixels via OBB mapping (point space -> YCbCr -> RGB).
8. Reads the written pixels back through a model of the target JPEG transport and runs SBR analysis against that lowband (see SBR, Encoder Analysis), then encodes 8 bytes of row SBR metadata.

Because MCUs span two image rows, images always contain an even number of data rows (unused blocks are written as silence).

## Row Metadata Encoding

Row metadata payload is 28 bytes:

- Bytes `0..7`: SBR row bytes
- Bytes `8..19`: six half-floats (`scaleYA`, `scaleYB`, `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY`)
- Bytes `20..27`: subgroup band factors (`A[4]`, `B[4]`) via log encoding

This 28-byte payload is LDPC-encoded to 32 bytes, whitened with a row-specific seed, and written to the final 4 blocks of the row.

## Multi-Image Chunking

- Audio is chunked by max image height (default 4096px).
- Split points are aligned to MDCT hop boundaries.
- The last MDCT block of a non-final image windows into the first hop of the next chunk, so TDAC holds across image boundaries.
- Header fields carry image index and total image count for reassembly.
