// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { PxfEncoder } from './encoder';
import { PxfDecoder } from './decoder';
import { createRNG } from './utils/rng';
import { ChunkingUtils } from './encoder/chunking';
import { MDCT_HOP_SIZE } from './constants';

describe('Integration Pipeline', () => {
    describe('Audio Pipeline', () => {
        const runPipelineTest = async (generatorType: 'sine' | 'silence' | 'noise' = 'sine') => {
            const sampleRate = 44100;
            const duration = 0.25;
            const length = Math.floor(sampleRate * duration);
            const channelData = new Float32Array(length);

            for (let i = 0; i < length; i++) {
                if (generatorType === 'sine') {
                    channelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
                } else if (generatorType === 'noise') {
                    channelData[i] = (Math.random() * 2 - 1) * 0.8;
                } else {
                    channelData[i] = 0;
                }
            }

            // Pass raw audio data
            const encodedResults = await PxfEncoder.encode(
                { audio: { channels: [channelData], sampleRate } },
                {'fn': 'test'}
            );

            expect(encodedResults.length).toBe(1);
            const rawImageData = encodedResults[0];

            // Prepare source from raw image data
            const source = PxfDecoder.load(rawImageData);
            const decodedResult = await PxfDecoder.decode([source]);

            if (decodedResult.type !== 'audio') {
                throw new Error("Decoder returned unexpected binary result for audio source");
            }

            expect(decodedResult.sampleRate).toBe(sampleRate);

            const durationOut = decodedResult.channels[0].length / decodedResult.sampleRate;
            expect(Math.abs(durationOut - duration)).toBeLessThan(0.15);

            const originalData = channelData;
            const decodedData = decodedResult.channels[0];

            let errorSum = 0;
            const len = Math.min(originalData.length, decodedData.length);
            for (let i = 0; i < len; i++) {
                const diff = originalData[i] - decodedData[i];
                errorSum += diff * diff;
            }
            const rmse = Math.sqrt(errorSum / len);

            let threshold = 0.06; // Slightly adjusted for linear quantization
            if (generatorType === 'silence') threshold = 1e-8;
            if (generatorType === 'noise') {
                threshold = 0.35; // Noise is harder to reconstruct perfectly
            }

            if (rmse > threshold) {
                throw new Error(`RMSE too high: ${rmse.toFixed(4)} (Limit: ${threshold})`);
            }
        };

        it('Sine wave pipeline', () => runPipelineTest('sine'));
        it('Silence pipeline', () => runPipelineTest('silence'));
        it('Noise pipeline', () => runPipelineTest('noise'));
    });

    it('Binary Pipeline (Random Data)', async () => {
        const size = 10000; // 10KB
        const originalData = new Uint8Array(size);
        const rng = createRNG(54321);
        for (let i = 0; i < size; i++) originalData[i] = rng.nextByte();

        const encodedResults = await PxfEncoder.encode(
            { binary: originalData },
            {'fn': 'random', 'comment': 'test binary'}
        );
        expect(encodedResults.length).toBe(1);

        const source = PxfDecoder.load(encodedResults[0]);
        const decodedResult = await PxfDecoder.decode([source]);

        if (decodedResult.type !== 'binary') {
            throw new Error("Decoder returned unexpected audio result for binary source");
        }

        expect(decodedResult.validChecksum).toBe(true);
        expect(decodedResult.data.length).toBe(size);

        for (let i = 0; i < size; i++) {
            if (decodedResult.data[i] !== originalData[i]) {
                throw new Error(`Binary mismatch at byte ${i}. Expected ${originalData[i]}, got ${decodedResult.data[i]}`);
            }
        }
    });

    it('Multi-Image Binary Pipeline (Large Data)', async () => {
        const size = 1024 * 100;
        const originalData = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            originalData[i] = i % 256; // Repeating pattern for easy verification
        }

        const encodedResults = await PxfEncoder.encode(
            { binary: originalData },
            {'fn': 'large_test.bin', 'comment': 'multi-image test'},
            { maxHeight: 256, }
        );

        // Should have multiple images
        expect(encodedResults.length).toBeGreaterThan(1);

        // All images should be under 4096px height
        for (const result of encodedResults) {
            expect(result.height).toBeLessThanOrEqual(256);
        }

        // Prepare sources from all images
        const sources = encodedResults.map(img => PxfDecoder.load(img));

        // Decode all images together
        const decodedResult = await PxfDecoder.decode(sources);

        if (decodedResult.type !== 'binary') {
            throw new Error("Decoder returned unexpected audio result for binary source");
        }

        expect(decodedResult.validChecksum).toBe(true);
        expect(decodedResult.data.length).toBe(size);

        // Verify data integrity
        for (let i = 0; i < size; i++) {
            if (decodedResult.data[i] !== originalData[i]) {
                throw new Error(`Binary mismatch at byte ${i}. Expected ${originalData[i]}, got ${decodedResult.data[i]}`);
            }
        }
    }, 15000);

    it('Multi-Image Audio Pipeline (Large Audio)', async () => {
        const sampleRate = 44100;
        const duration = 20; // 1 minute- should require multiple images
        const length = Math.floor(sampleRate * duration);
        const channelData = new Float32Array(length);

        // Generate a sine wave
        for (let i = 0; i < length; i++) {
            channelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.8;
        }

        const encodedResults = await PxfEncoder.encode(
            { audio: { channels: [channelData], sampleRate } },
            {'fn': 'large_audio_test.wav'},
            { maxHeight: 256 } // Use smaller max height to force more images but keep test faster
        );

        // Should have multiple images
        expect(encodedResults.length).toBeGreaterThan(1);

        // All images should be under 4096px height
        for (const result of encodedResults) {
            expect(result.height).toBeLessThanOrEqual(256);
        }

        // Prepare sources from all images
        const sources = encodedResults.map(img => PxfDecoder.load(img));

        // Decode all images together
        const decodedResult = await PxfDecoder.decode(sources);

        if (decodedResult.type !== 'audio') {
            throw new Error("Decoder returned unexpected binary result for audio source");
        }

        expect(decodedResult.sampleRate).toBe(sampleRate);

        // Verify duration is approximately correct
        const decodedDuration = decodedResult.channels[0].length / decodedResult.sampleRate;
        expect(Math.abs(decodedDuration - duration)).toBeLessThan(1.0); // Allow some tolerance

        // Verify audio quality
        const originalData = channelData;
        const decodedData = decodedResult.channels[0];

        let errorSum = 0;
        const len = Math.min(originalData.length, decodedData.length);
        for (let i = 0; i < len; i++) {
            const diff = originalData[i] - decodedData[i];
            errorSum += diff * diff;
        }
        const rmse = Math.sqrt(errorSum / len);

        // Should have reasonable quality
        expect(rmse).toBeLessThan(0.08);
    }, 60000);

    describe('TDAC across image boundaries', () => {
        const sampleRate = 44100;
        const maxHeight = 256;
        const samplesPerImage = ChunkingUtils.calculateMaxSamplesPerImage(maxHeight);
        const length = samplesPerImage * 2 + 5000;

        const hopRmse = (original: Float32Array, decoded: Float32Array, start: number) => {
            let errorSum = 0;
            for (let i = start; i < start + MDCT_HOP_SIZE; i++) {
                const diff = original[i] - decoded[i];
                errorSum += diff * diff;
            }
            return Math.sqrt(errorSum / MDCT_HOP_SIZE);
        };

        const runBoundaryTest = async (channels: Float32Array[]) => {
            const encodedResults = await PxfEncoder.encode(
                { audio: { channels, sampleRate } },
                { 'fn': 'tdac_test.wav' },
                { maxHeight }
            );
            expect(encodedResults.length).toBe(3 * channels.length);

            const decodedResult = await PxfDecoder.decode(encodedResults.map(img => PxfDecoder.load(img)));
            if (decodedResult.type !== 'audio') {
                throw new Error("Decoder returned unexpected binary result for audio source");
            }

            for (let c = 0; c < channels.length; c++) {
                const interior = hopRmse(channels[c], decodedResult.channels[c], Math.floor(samplesPerImage / 2));
                for (const boundary of [samplesPerImage, samplesPerImage * 2]) {
                    // The first hop of an image must reconstruct as well as any other hop
                    expect(hopRmse(channels[c], decodedResult.channels[c], boundary)).toBeLessThan(Math.max(0.01, interior * 3));
                    expect(hopRmse(channels[c], decodedResult.channels[c], boundary - MDCT_HOP_SIZE)).toBeLessThan(Math.max(0.01, interior * 3));
                }
            }
        };

        const tone = (frequency: number) => {
            const data = new Float32Array(length);
            for (let i = 0; i < length; i++) {
                data[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5;
            }
            return data;
        };

        it('Mono', () => runBoundaryTest([tone(1000)]), 60000);
        it('Stereo', () => runBoundaryTest([tone(1000), tone(1500)]), 60000);
    });
});
