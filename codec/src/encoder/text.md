---
order: 20
title: Text Row Rendering
---

`TextRenderer.drawTextRow(...)` writes the human-readable info row (row 1) using a compact bitmap font.

## Rendering Rules

- Font: 3x5 glyphs (`FONT_GLYPHS`), 1-pixel horizontal spacing
- Start position:
  - `x = 4` pixels left padding
  - `y = rowIndex * 8 + 2` (vertical centering inside the 8-pixel row)
- Unknown characters use `UNKNOWN_GLYPH`
- Characters are uppercased at render time

## Safety Boundary

Renderer reserves the rightmost 4 blocks:
- max text x-limit is `width - BLOCK_SIZE * 4`
- this keeps space for header checksum bytes stored in row 1 tail blocks

## Pixel Writes

Only foreground white pixels are written (`RGB=255`); background pixels are left unchanged.
