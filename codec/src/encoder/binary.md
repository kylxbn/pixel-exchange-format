---
order: 15
title: Binary Mode Format
---

Binary mode stores arbitrary data in Pixel Exchange Format images. Large files are split across multiple images with error correction and integrity checking.

## Image Structure

- Row 0 (8 px): Header (format metadata)
- Row 1 (8 px): Text information (human-readable)
- From y = 16: one strip of 16 px per codeword

The header and text rows together are one 16 px MCU row, so the strips sit on the 16x16 MCU grid of a 4:2:0 JPEG. Every block of a strip carries data; there are no per-row metadata blocks.

## Strip Format

Each strip holds one LDPC codeword of 64896 bits:

| Part | Size |
| --- | --- |
| Payload | 7296 bytes |
| CRC32C of the payload | 4 bytes, big-endian |
| LDPC parity | 6496 bits |

That is 3.56 payload bits per pixel. Parity and CRC are modulated exactly like the payload, at the same density.

Encoding a strip:

1. Take 7296 payload bytes, zero-padded in the last strip of an image.
2. Append the CRC32C of those 7296 bytes.
3. LDPC-encode the 7300 bytes (`K = 58400`, `N = 64896`, systematic).
4. XOR the codeword with the whitening mask of the strip.
5. Permute the bits.
6. Map the bits to DCT coefficients and render the pixels.

Steps 4 to 6 are specified under Binary Modulation and Data Permutation. The strip index used for whitening is local to each image (`0..numStrips-1`).

## Design Target

The level spacings are sized for baseline JPEG at libjpeg quality 90 with 4:2:0 chroma, and the code rate (0.90) leaves room for one quality step below that and for decoders that smooth chroma when upsampling. Measured with libjpeg-turbo 3.2 on random payloads (64 strips each):

| Transport | Result |
| --- | --- |
| lossless | intact |
| JPEG 4:2:0, quality 95 / 92 / 90 / 89 | intact, with box and with smoothed chroma upsampling |
| JPEG 4:2:0, quality 88 | lost |
| JPEG 4:4:4, quality 90 | intact |
| jpegli quality 95, WebP quality 95 | intact |
| jpegli quality 90, WebP quality 90 | lost |

Other encoders are not a design target. The format only requires RGB pixels in and out.

## Multi-Image Files

Large binary data is split across multiple images:
- Each image contains a sequential chunk of data
- Header indicates total images and current index
- Images are processed in order to reconstruct complete files

An image of height `H` holds `floor((H - 16) / 16)` strips.

## Header Information

The global header provides:
- Per-image chunk size and data parameters
- Channel mode (binary = 3)
- Random seed for reproducible processing
- Multi-image sequencing metadata
- User-defined metadata dictionary

## Output Format

Images are 1024 pixels wide with height determined by data size. PNG format ensures lossless storage.
