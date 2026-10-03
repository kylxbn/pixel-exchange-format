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

export { AUDIO_PSYCHOACOUSTICS } from './psychoacoustics';

// Layout facts and inspection helpers that UIs need to display or validate
// against. These are part of the format, not implementation details.
export {
    FORMAT_VERSION, SUPPORTED_FORMAT_VERSIONS, CHANNEL_MODE,
    BLOCK_SIZE, IMAGE_WIDTH, BLOCKS_PER_ROW, DATA_BLOCKS_PER_ROW,
    MAX_STRING_DATA_BYTES, MAX_METADATA_KEY_BYTES, MAX_METADATA_VALUE_BYTES,
} from './constants';
export { audioBlockToImageBlock, imageBlockToAudioBlock, audioRowImageSpan } from './audioLayout';
export { ChunkingUtils } from './encoder/chunking';
export {
    decodeRowSBR, getSbrSubgroupIndexForBlock, getSbrSubgroupRange,
    SBR_SUBGROUPS_PER_ROW, PATCH_MODE_NAMES, PROCESSING_MODE_NAMES, TRANSIENT_SHAPE_NAMES,
} from './utils/sbr';
export type { SBRParams, SBRParamsTemporal, SBRParamsUnion, RowSBRParams } from './utils/sbr';

import { VERSION as SOFTWARE_VERSION, BUILD_HASH } from './buildInfo';
export const VERSION = `${SOFTWARE_VERSION}-${BUILD_HASH}`;
