// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, expect, it } from 'vitest';
import { FONT_GLYPHS } from './font';
import { TextRenderer } from './text';

describe('TextRenderer.toDisplayText', () => {
    it('transliterates non-latin text to ascii for display', () => {
        const output = TextRenderer.toDisplayText('Δημήτρης Φωτόπουλος');
        expect(output).toBe('DIMITRIS FOTOPOYLOS');
    });

    it('keeps output within the bitmap font glyph set', () => {
        const output = TextRenderer.toDisplayText('日本語 테스트 مثال');
        for (const char of output) {
            expect(FONT_GLYPHS[char]).toBeDefined();
        }
    });
});

