---
order: 23
title: Binary Mode Decoding
---

Binary mode decoding reconstructs data from Pixel Exchange Format images. Multi-image files are processed in sequence to recover complete binary data.

## Multi-Image Processing

Images are sorted by index from the header and processed sequentially. Each image contains a chunk of the total data with its size given in the header.

## Image Processing

The number of strips is `ceil(chunkSize / 7296)`. For each image, decoders must:

1. Read the DCT coefficients of every strip from the RGB pixels (16 px per strip, starting at y = 16).
2. Estimate the noise of each coefficient position over the whole image.

Then, per strip:

3. Soft-demodulate the coefficients into 64896 LLRs.
4. Reverse the bit permutation and the whitening (flip the LLR sign where the mask bit is 1).
5. LDPC decode (`K = 58400`, `N = 64896`).
6. Check the CRC32C stored after the 7296 payload bytes.

Steps 1 to 4 are specified under Binary Modulation and Data Permutation. The decoder works from pixels alone; it does not use quantization tables or coefficients of a JPEG file.

## Output Assembly

Decoded payloads are concatenated in strip order and truncated to the chunk size; chunks from all images are concatenated in index order.

## Health Report

For diagnostics a decoder may report, per strip, the share of the 58400 message bits whose hard decision before LDPC decoding matched the decoded result. A strip that fails LDPC decoding or its CRC reports 0.

## Usage in Format

Binary mode enables reliable storage and transmission of arbitrary data through images, with error correction ensuring data integrity.
