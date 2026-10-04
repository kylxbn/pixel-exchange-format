---
order: 2
title: Format Overview
---

The Pixel Exchange Format (PXF) v301 encodes audio or arbitrary binary data into fixed-width images. It combines deterministic transforms, forward error correction, and integrity checks so data can be reconstructed after common image degradation.

## Encoding Modes

### Audio Mode
Audio is encoded with:
- 256-sample MDCT windows (`hop = 128`)
- 96 stored bins per block (64 luma + 32 chroma-interleaved)
- 8-byte per-row SBR side data (for bins 96-127 reconstruction)
- Per-row LDPC-protected metadata for scaling and band factors

Stereo is represented as mid/side image pairs, not left/right image channels.

### Binary Mode
Binary mode stores 7296 bytes per 16 px strip (3.56 bits per pixel). The bits are written as PAM symbols on 8x8 DCT coefficients on the JPEG 4:2:0 block grid, sized to survive JPEG at quality 90, and each strip is one LDPC codeword that also carries its CRC32C.

## Decoding Capabilities

Decoding supports:
- Full reconstruction from complete images
- Streaming/progressive audio decode via `StreamingAudioDecoder`
- Multi-image reassembly using header random bytes + image indices
- Source grouping by shared 4-byte random header salt; when multiple groups are present, the decoder uses the largest group

## Image Structure

All images are 1024 pixels wide:
- Row 0: LDPC-protected header stream
- Row 1: human-readable text row
- Rows 2+: audio payload rows with per-row metadata in the final 4 blocks, or binary strips of 16 px that use the full width

## Channel Configurations

Audio mode supports:
- Mono: single channel audio
- Stereo mid (`channelMode=1`) and side (`channelMode=2`) images

Stereo decoding behavior:
- Side-only inputs are rejected
- Missing side images during mid/side decode fall back to mono (mid duplicated to both channels)

## Versioning and Compatibility

The implementation uses `FORMAT_VERSION = 301`, the only version the decoder accepts, with deterministic seeded whitening/permutation and precomputed LDPC graphs so encoder and decoder remain bit-compatible.
