// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { BLOCK_SIZE } from "constants";
import { FONT_GLYPHS, UNKNOWN_GLYPH } from "./font";
import anyAscii from "any-ascii";

export class TextRenderer {
    private static readonly UNKNOWN_FALLBACK_CHAR = "?";

    public static toDisplayText(text: string): string {
        const ascii = anyAscii(text).toUpperCase();
        let normalized = "";

        for (let i = 0; i < ascii.length; i++) {
            const char = ascii[i];

            if (char === "\r" || char === "\n" || char === "\t") {
                normalized += " ";
                continue;
            }

            normalized += FONT_GLYPHS[char]
                ? char
                : TextRenderer.UNKNOWN_FALLBACK_CHAR;
        }

        return normalized;
    }

    public static drawTextRow(
        text: string,
        imageData: Uint8ClampedArray,
        width: number,
        rowIndex: number
    ) {
        const yStart = rowIndex * 8;
        
        // Draw Text
        let xCursor = 4; // Start with a small padding
        const yTextStart = yStart + 2; // Center vertically (2px padding top, 5px text, 1px bottom)

        const maxWidth = width - BLOCK_SIZE * 4; // checksum

        for (let i = 0; i < text.length; i++) {
            const char = text[i].toUpperCase();
            const glyph = FONT_GLYPHS[char] || UNKNOWN_GLYPH;
            
            if (xCursor + 4 > maxWidth) break; // Stop if out of bounds

            for (let r = 0; r < 5; r++) { // 5 rows
                const rowBits = glyph[r];
                for (let c = 0; c < 3; c++) { // 3 cols
                    // Check bit (column 0 is MSB: 4, col 1: 2, col 2: 1)
                    const bit = (rowBits >> (2 - c)) & 1;
                    if (bit) {
                        const x = xCursor + c;
                        const y = yTextStart + r;
                        const offset = (y * width + x) * 4;
                        imageData[offset] = 255;
                        imageData[offset + 1] = 255;
                        imageData[offset + 2] = 255;
                    }
                }
            }
            xCursor += 4; // 3px char + 1px space
        }
    }

}
