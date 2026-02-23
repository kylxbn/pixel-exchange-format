---
order: 18
title: Encoder Entry Point
---

`PxfEncoder` is the high-level encoding API used by consumers of the codec package.

## Public API

`PxfEncoder.encode(data, metadata?, options?, onProgress?)`:
- Accepts either:
  - `data.audio` (`channels: Float32Array[]`, `sampleRate`)
  - `data.binary` (`Uint8Array`)
- Returns `Promise<EncodedImageResult[]>` where each result contains:
  - `data` (RGBA pixel buffer)
  - `width`, `height`
  - `name` (default filename with optional chunk suffix)

If both `audio` and `binary` are present, current implementation takes the audio path first.

## Metadata Validation

Before encoding, metadata is validated as UTF-8:
- Maximum pairs: `255`
- Maximum key size: `15` bytes
- Maximum value size: `4095` bytes
- Serialized metadata budget: `MAX_STRING_DATA_BYTES` (`747` bytes), including the initial pair-count byte and per-pair 2-byte length words

Validation errors throw before any encoding work begins.

## Dispatch Behavior

- Audio input dispatches to `AudioEncoder.encodeAudio(...)`
- Binary input dispatches to `BinaryEncoder.encodeBinary(...)`
- Missing input throws `No data provided to encode.`

`options.maxHeight` is forwarded to chunking logic (default chunking target is 4096 px image height).
