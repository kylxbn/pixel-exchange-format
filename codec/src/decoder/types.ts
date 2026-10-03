// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { StreamingAudioDecoder } from './audio';

export interface RawImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface VisualizationMetadata {
    hopSize: number;
    firstAudioBlockIndex: number;
    sampleRate: number;
    blocksPerRow: number;
    totalAudioBlocks: number;
    version: number;
}

export interface ImageSource {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    channelMode: number;
    visualizationMetadata: VisualizationMetadata;
    totalSamples: number; // Interpreted as file size for binary
    sampleRate: number;
    metadata: Record<string, string>;
    randomBytes: Uint8Array;
    imageIndex: number;
    totalImages: number;
}

export interface AudioResult {
    type: 'audio';
    channels: Float32Array[];
    sampleRate: number;
    metadata: Record<string, string>;
    visualizationMetadata: VisualizationMetadata;
    sourceImageIndex: number;
    decoder: StreamingAudioDecoder;
}

export interface BinaryResult {
    type: 'binary';
    data: Uint8Array;
    metadata: Record<string, string>;
    visualizationMetadata: VisualizationMetadata;
    validChecksum: boolean;
}

export type DecodeResult = AudioResult | BinaryResult;

export interface BinaryDecodeDebugCapture {
    rowHealth: number[];
    overallHealth?: number;
}

export interface BlockStats {
    lumaScale: number;
    chromaScale: number;
    bandFactors: Float32Array;
    sbrData: Uint8Array | null;
}

export interface AudioRowMetadata {
    scaleYA: number;
    scaleYB: number;
    scaleCAX: number;
    scaleCAY: number;
    scaleCBX: number;
    scaleCBY: number;
    bandFactorsA: Float32Array;
    bandFactorsB: Float32Array;
    sbrData: Uint8Array | null;
}
