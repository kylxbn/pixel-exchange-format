---
order: 21
title: Decoding Requirements
---

Decoders must support both audio and binary mode decoding from PXF images, including multi-image grouping, ordering, and row-level error correction.

## Input Processing

Decoders must:
- Parse the header from the first image row of each image
- Extract format metadata, parameters, and integrity checks
- Validate format version compatibility
- Reject mixed audio+binary source sets in one decode call
- Group multi-image sequences by random seed
- Sort images by index within each sequence
- If multiple groups are present, decode the largest group
- Tolerate incomplete sequences (implementation warns and decodes available images)

## Decoding Modes

### Audio Mode
Decoders must reconstruct PCM audio data with:
- Support for mono and stereo configurations
- Proper sample rate from header
- Mid/side pairing support (`mode 1 + mode 2`)
- Full reconstruction of bins `0..127` via stored bins + SBR synthesis
- Side-only input rejection

### Binary Mode
Decoders must extract arbitrary binary data with:
- Error correction and integrity validation
- Support for files split across multiple images
- Pair-level permutation reversal before LDPC decode

## Error Correction

Decoders must implement LDPC error correction for:
- Header data (6144 data bits, 8192 total bits)
- Row metadata (224 data bits, 256 total bits)
- Binary payload data (19840 data bits, 20064 total bits)

Various LDPC decoding algorithms may be used, with soft-decision decoding providing better performance but not strictly required.

## Output Requirements

### Audio Output
- Float32Array channels matching original sample rate
- Proper duration based on total samples from header
- Support for mono and stereo mid/side reconstruction

### Binary Output
- Concatenated byte data from multi-image sequences
- Integrity validation using included checksums
- Metadata extraction for filenames and user data

## Metadata-Only Path

`decodeMetadataOnly` returns:
- Full binary decode for binary mode (same as normal path)
- Audio metadata + initialized streaming decoder for audio mode, without decoding PCM up front

## Usage in Format

The format enables reliable data recovery with error correction, supporting both complete decoding and streaming applications.
