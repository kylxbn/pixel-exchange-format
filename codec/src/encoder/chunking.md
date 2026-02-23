---
order: 17
title: Multi-Image Chunking
---

Chunking splits large audio or binary payloads into multiple images while preserving deterministic decoder reassembly.

## Defaults

- Default `maxHeight` is `4096` pixels.
- With fixed width `1024`, default max image area is `4,194,304` pixels.

## Audio Chunking

Audio chunking is hop-aligned:

1. Compute max usable audio capacity from `maxHeight`:
   - total block rows = `floor(maxHeight / 8)`
   - remove 2 rows for header/text
   - remaining rows contribute `124` audio blocks per row
   - each audio block = one MDCT hop (`128` samples)
2. Align per-image sample capacity to hop boundaries.
3. Slice each channel with the same sample boundaries.

This guarantees chunk boundaries do not break MDCT hop alignment.

## Binary Chunking

Binary chunking is byte-based:

1. Compute max data rows = `floor(maxHeight / 8) - 2`.
2. Per-row capacity is `2480` bytes.
3. Slice the payload into contiguous chunks of `maxDataRows * 2480` bytes.

## Reassembly Metadata

Each chunk/image header stores:
- `imageIndex` (1-based)
- `totalImages`
- shared `randomBytes` group identifier

Decoder sorts by `imageIndex` within matching `randomBytes` groups to rebuild the full payload.
