// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export { PxfEncoder } from './encoder/';
export type { EncodedImageResult } from './encoder/';

export { PxfDecoder } from './decoder';
export { StreamingAudioDecoder } from './decoder/audio';
export type {
    DecodeResult, BinaryResult, AudioResult, ImageSource, RawImageData,
    VisualizationMetadata, BlockStats, BinaryDecodeDebugCapture
} from './decoder/';

export { FORMAT_VERSION } from "./constants";
export { AUDIO_PSYCHOACOUSTICS } from './psychoacoustics';

import { VERSION as SOFTWARE_VERSION, BUILD_HASH } from './buildInfo';
export const VERSION = `${SOFTWARE_VERSION}-${BUILD_HASH}`;
