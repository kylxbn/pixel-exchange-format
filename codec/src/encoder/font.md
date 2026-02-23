---
order: 29
title: Bitmap Font
---

`font.ts` defines the fixed 3x5 bitmap glyph set used for row-1 info text rendering.

## Data Model

- `FONT_GLYPHS: Record<string, number[]>`
  - 5 rows per glyph
  - each row is a 3-bit mask (`0..7`)
- `UNKNOWN_GLYPH`
  - fallback shape for unsupported characters

Example row encoding:
- `7` = `111`
- `5` = `101`
- `2` = `010`

Glyphs are consumed by `TextRenderer.drawTextRow(...)`.
