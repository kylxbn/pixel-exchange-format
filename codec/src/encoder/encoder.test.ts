// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect, vi } from 'vitest';
import { PxfEncoder } from '.';

describe('PxfEncoder', () => {

    describe('Validation', () => {
        it('should throw if no data provided', async () => {
            await expect(PxfEncoder.encode({}, {})).rejects.toThrow("No data provided to encode");
        });
    });

    describe('Audio Encoding', () => {
        const createAudioData = (channels = 1) => {
            const sampleRate = 44100;
            const len = 1000;
            const data = [];
            for (let i = 0; i < channels; i++) {
                data.push(new Float32Array(len).fill(0));
            }
            return { channels: data, sampleRate };
        };

        it('should encode mono audio', async () => {
            const audio = createAudioData(1);
            const res = await PxfEncoder.encode({ audio }, {'fn': 'mono'});
            expect(res.length).toBe(1);
            expect(res[0].name).toBe("mono.png");
            expect(res[0].width).toBeGreaterThan(0);
        });

        it('should encode stereo audio (Mid/Side)', async () => {
            const audio = createAudioData(2);
            // Make them slightly different to ensure distinct M/S
            audio.channels[0][0] = 0.5;
            audio.channels[1][0] = -0.5;

            const res = await PxfEncoder.encode({ audio }, {});
            expect(res.length).toBe(2);
            expect(res[0].name).toContain("_1_2.png");
            expect(res[1].name).toContain("_2_2.png");
        });

        it('should call onProgress callback', async () => {
            const audio = createAudioData(1);
            const onProgress = vi.fn();

            await PxfEncoder.encode({ audio }, {}, {}, onProgress);

            expect(onProgress).toHaveBeenCalled();
            expect(onProgress).toHaveBeenCalledWith(100);
        });
    });

    describe('Binary Encoding', () => {
        it('should encode binary data', async () => {
            const data = new Uint8Array(200).fill(1);
            const res = await PxfEncoder.encode({ binary: data }, {'fn': "bin"});

            expect(res.length).toBe(1);
            expect(res[0].name).toBe("bin.png");
        });

        it('should call onProgress for binary', async () => {
            const onProgress = vi.fn();
            const largeData = new Uint8Array(100 * 2000); // ~200KB

            await PxfEncoder.encode({ binary: largeData }, {}, {}, onProgress);

            expect(onProgress).toHaveBeenCalled();
            expect(onProgress).toHaveBeenCalledWith(100);
        });
    });
});
