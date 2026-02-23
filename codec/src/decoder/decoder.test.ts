// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, it, expect } from 'vitest';
import { CHANNEL_MODE } from '../constants';
import { StreamingAudioDecoder } from './audio';
import { PxfEncoder } from '../encoder';
import { PxfDecoder } from '.';

// Helper to create a small valid encoded image
async function createEncodedAudioImage(sampleRate = 44100, duration = 0.1, metadata: Record<string, string> = {}) {
    const length = Math.floor(sampleRate * duration);
    const channelData = new Float32Array(length).fill(0).map((_, i) => Math.sin(2 * Math.PI * 440 * i / sampleRate));

    const results = await PxfEncoder.encode(
        { audio: { channels: [channelData], sampleRate } },
        metadata
    );
    return results[0];
}

async function createEncodedBinaryImage(size = 100, metadata: Record<string, string> = {}) {
    const data = new Uint8Array(size).map((_, i) => i % 255);
    const results = await PxfEncoder.encode(
        { binary: data },
        metadata
    );
    return results[0];
}

describe('PxfDecoder', () => {

    describe('General API', () => {
        it('should throw error if sources array is empty', async () => {
            await expect(PxfDecoder.decode([])).rejects.toThrow("No valid sources found");
            await expect(PxfDecoder.decodeMetadataOnly([])).rejects.toThrow("No valid sources found");
        });

        it('should throw error if mixing binary and audio files', async () => {
            const audioImg = await createEncodedAudioImage();
            const binImg = await createEncodedBinaryImage();

            const srcAudio = PxfDecoder.load(audioImg);
            const srcBin = PxfDecoder.load(binImg);

            // Mock channel modes to simulate the mix check failure explicitly if prepareSource doesn't set it (it does)
            // But just passing them together should trigger it
            await expect(PxfDecoder.decode([srcAudio, srcBin])).rejects.toThrow("Unable to decode images containing both audio and binary data");
        });
    });

    describe('Metadata Decoding', () => {
        it('should decode metadata without decoding full audio', async () => {
            const img = await createEncodedAudioImage(48000, 0.5, { 'fn': "meta_test", 'comment': "meta comment" });
            const src = PxfDecoder.load(img);

            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            // Cast to AudioResult to access audio specific props
            if (result.type === 'audio') {
                expect(result.sampleRate).toBe(48000);
                expect(result.metadata.fn).toBe("meta_test");
                expect(result.metadata.comment).toBe("meta comment");
                expect(result.channels.length).toBe(0); // Should be empty
                expect(result.metadata).toBeDefined();
            }
        });

        it('should handle empty metadata', async () => {
            const img = await createEncodedAudioImage(44100, 0.1, {});
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(Object.keys(result.metadata)).toHaveLength(0);
            }
        });

        it('should preserve arbitrary key-value pairs', async () => {
            const testMetadata = {
                'artist': 'Test Artist',
                'album': 'Test Album',
                'title': 'Test Song',
                'year': '2024',
                'genre': 'Electronic',
                'custom_field': 'custom_value',
                'unicode_test': '日本語のテスト🎵'
            };

            const img = await createEncodedAudioImage(44100, 0.1, testMetadata);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(result.metadata).toEqual(testMetadata);
            }
        });

        it('should handle special characters and edge cases', async () => {
            const specialMetadata = {
                'empty_value': '',
                'special_chars': '!@#$%^&*()_+-=[]{}|;:,.<>?',
                'multiline': 'line1\nline2\ttab',
                'json_like': '{"key": "value", "number": 123}',
                'valid_key': 'short_value'
            };

            const img = await createEncodedAudioImage(44100, 0.1, specialMetadata);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(result.metadata).toEqual(specialMetadata);
            }
        });

        it('should handle large metadata values', async () => {
            // Create metadata with a large value (under the total size limit)
            const longValue = 'x'.repeat(500); // Large but under total limit
            const metadata = {
                'long_value': longValue,
                'another_field': 'test'
            };

            const img = await createEncodedAudioImage(44100, 0.1, metadata);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(result.metadata.long_value).toBe(longValue);
                expect(result.metadata.another_field).toBe('test');
            }
        });

        it('should validate key length limits', async () => {
            const invalidMetadata = {
                'this_key_is_way_too_long_and_should_fail_validation_because_it_exceeds_15_characters': 'value'
            };

            await expect(createEncodedAudioImage(44100, 0.1, invalidMetadata))
                .rejects.toThrow(/too long.*max 15/);
        });

        it('should validate value length limits', async () => {
            const invalidMetadata = {
                'key': 'x'.repeat(4100) // Exceeds 4095 limit
            };

            await expect(createEncodedAudioImage(44100, 0.1, invalidMetadata))
                .rejects.toThrow(/too long.*max 4095/);
        });

        it('should validate total metadata size limit', async () => {
            // Create metadata that exceeds MAX_STRING_DATA_BYTES (747)
            const largeMetadata: Record<string, string> = {};
            for (let i = 0; i < 10; i++) {
                largeMetadata[`k${i}`] = 'x'.repeat(80); // ~80 bytes per entry, total ~800 bytes
            }

            await expect(createEncodedAudioImage(44100, 0.1, largeMetadata))
                .rejects.toThrow(/too large.*max 747/);
        });



        it('should handle binary files with metadata', async () => {
            const binaryMetadata = {
                'fn': 'test.bin',
                'comment': 'Test binary file',
                'size': '1024',
                'type': 'application/octet-stream'
            };

            const img = await createEncodedBinaryImage(100, binaryMetadata);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decode([src]);

            expect(result.type).toBe('binary');
            if (result.type === 'binary') {
                expect(result.metadata).toEqual(binaryMetadata);
                expect(result.metadata.fn).toBe('test.bin');
                expect(result.metadata.comment).toBe('Test binary file');
            }
        });

        it('should sort metadata keys alphabetically during encoding', async () => {
            const unsortedMetadata = {
                'zebra': 'last',
                'alpha': 'first',
                'middle': 'center'
            };

            const img = await createEncodedAudioImage(44100, 0.1, unsortedMetadata);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                // Should be sorted alphabetically: alpha, middle, zebra
                const keys = Object.keys(result.metadata);
                expect(keys).toEqual(['alpha', 'middle', 'zebra']);
                expect(result.metadata.alpha).toBe('first');
                expect(result.metadata.middle).toBe('center');
                expect(result.metadata.zebra).toBe('last');
            }
        });

        it('should handle duplicate keys (last one wins)', async () => {
            const metadata = new Map([
                ['test_key', 'first_value'],
                ['test_key', 'second_value'], // This should overwrite in Map
                ['other_key', 'other_value']
            ]);

            const metadataObj = Object.fromEntries(metadata);
            const img = await createEncodedAudioImage(44100, 0.1, metadataObj);
            const src = PxfDecoder.load(img);
            const result = await PxfDecoder.decodeMetadataOnly([src]);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(result.metadata.test_key).toBe('second_value'); // Last one wins
                expect(result.metadata.other_key).toBe('other_value');
            }
        });
    });

    describe('StreamingAudioDecoder', () => {
        it('should initialize and contain correct metadata', async () => {
            const img = await createEncodedAudioImage();
            const src = PxfDecoder.load(img);
            const decoder = new StreamingAudioDecoder([src]);

            expect(decoder.sampleRate).toBe(44100);
            expect(decoder.totalSamples).toBeGreaterThan(0);
            expect(decoder.duration).toBeCloseTo(0.1);
        });

        it('should throw if trying to decode side channel only', async () => {
            const img = await createEncodedAudioImage();
            const src = PxfDecoder.load(img);
            src.channelMode = CHANNEL_MODE.STEREO_SIDE; // Force side mode

            expect(() => new StreamingAudioDecoder([src])).toThrow("Unable to decode side channel only");
        });

        it('should seek and decode chunks correctly', async () => {
            // Create longer audio to allow seeking
            const img = await createEncodedAudioImage(44100, 1.0); // 1 second
            const src = PxfDecoder.load(img);
            const decoder = new StreamingAudioDecoder([src]);

            // Decode first chunk
            const chunk1 = decoder.decodeChunk(0.1);
            expect(chunk1[0].length).toBeGreaterThan(0);

            // Seek
            const seekSample = Math.floor(44100 * 0.5);
            decoder.seek(seekSample);

            const chunk2 = decoder.decodeChunk(0.1);
            expect(chunk2[0].length).toBeGreaterThan(0);

            // Verify subsequent reads continue
            const chunk3 = decoder.decodeChunk(0.1);
            expect(chunk3[0].length).toBeGreaterThan(0);
        });

        it('check mismatch mid/side sources', async () => {
            const img1 = await createEncodedAudioImage(44100, 0.1, { 'fn': 'file1' });
            const img2 = await createEncodedAudioImage(44100, 0.1, { 'fn': 'file2' }); // Different filename

            const src1 = PxfDecoder.load(img1);
            src1.channelMode = CHANNEL_MODE.STEREO_MID;
            src1.imageIndex = 1;
            src1.totalImages = 2;

            const src2 = PxfDecoder.load(img2);
            src2.channelMode = CHANNEL_MODE.STEREO_SIDE;
            src2.imageIndex = 2;
            src2.totalImages = 2;

            expect(() => new StreamingAudioDecoder([src1, src2])).toThrow("Mid and side channel data do not belong together (random bytes mismatch).");
        });

        it('should decode multi-part stereo correctly', async () => {
            // Create stereo audio that's long enough to be split into multiple images
            const sampleRate = 44100;
            const duration = 20; // 5 minutes, should split into multiple parts
            const length = Math.floor(sampleRate * duration);
            const left = new Float32Array(length).fill(0).map((_, i) => Math.sin(2 * Math.PI * 440 * i / sampleRate));
            const right = new Float32Array(length).fill(0).map((_, i) => Math.sin(2 * Math.PI * 660 * i / sampleRate));

            const results = await PxfEncoder.encode(
                { audio: { channels: [left, right], sampleRate } },
                { fn: 'stereo_test' },
                { maxHeight: 256, }
            );

            // Should have multiple images (mids and sides)
            expect(results.length).toBe(4); // At least mid1, side1, mid2, side2

            const sources = results.map(img => PxfDecoder.load(img));

            // Group by randomBytes and take the largest group
            const groups = new Map<string, typeof sources>();
            for (const source of sources) {
                const key = Array.from(source.randomBytes).join(',');
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key)!.push(source);
            }
            const largestGroup = [...groups.values()].sort((a, b) => b.length - a.length)[0];

            const result = await PxfDecoder.decode(largestGroup);

            expect(result.type).toBe('audio');
            if (result.type === 'audio') {
                expect(result.channels.length).toBe(2); // Stereo
                expect(result.channels[0].length).toBe(length);
                expect(result.channels[1].length).toBe(length);

                // Check that output is not silent
                const leftRMS = Math.sqrt(result.channels[0].reduce((sum, x) => sum + x * x, 0) / length);
                const rightRMS = Math.sqrt(result.channels[1].reduce((sum, x) => sum + x * x, 0) / length);

                expect(leftRMS).toBeGreaterThan(0.1); // Should not be silent
                expect(rightRMS).toBeGreaterThan(0.1);
            }
        }, 60000);

        it('getStatsAtBlock should return valid stats', async () => {
            const img = await createEncodedAudioImage();
            const src = PxfDecoder.load(img);
            const decoder = new StreamingAudioDecoder([src]);

            // Should return null for out of bounds
            expect(decoder.getStatsAtBlock(999999)).toBeNull();

            // Should return logic for valid block (block 0 might be silence/ramp up, check block 2)
            const stats = decoder.getStatsAtBlock(2);
            expect(stats).not.toBeNull();
            if (stats) {
                expect(stats.bandFactors.length).toBe(4);
                expect(stats.lumaScale).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe('Binary Decoding & Inspection', () => {
        it('decodeBinary should handle binary files', async () => {
            const dataSize = 500;
            const img = await createEncodedBinaryImage(dataSize);
            const src = PxfDecoder.load(img);

            const result = await PxfDecoder.decode([src]);

            expect(result.type).toBe('binary');
            if (result.type === 'binary') {
                expect(result.data.length).toBe(dataSize);
                expect(result.validChecksum).toBe(true);
            }
        });
    });
});
