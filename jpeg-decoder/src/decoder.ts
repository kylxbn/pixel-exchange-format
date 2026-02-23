// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { RawImageData } from '@pixel-exchange-format/codec';
import type { JPEGData } from './parser';
import { HuffmanDecoder, BitStream } from './huffman';
import { inverseDCT, zigzagToNatural } from './dct';
import { blocksToComponent, combineComponents } from './color';

export function decodeImage(jpegData: JPEGData): RawImageData {
  // Set up Huffman decoders
  const dcDecoders = new Map<number, HuffmanDecoder>();
  const acDecoders = new Map<number, HuffmanDecoder>();

  jpegData.huffmanTablesDC.forEach((table, id) => {
    dcDecoders.set(id, new HuffmanDecoder(table));
  });
  jpegData.huffmanTablesAC.forEach((table, id) => {
    acDecoders.set(id, new HuffmanDecoder(table));
  });

  // Decode scan data into grids of blocks
  const bitStream = new BitStream(jpegData.scanData);
  const componentGrids = decodeScanData(
    bitStream,
    jpegData,
    dcDecoders,
    acDecoders
  );

  // Sampling factors
  const maxH = Math.max(...jpegData.components.map(c => c.horizontalSampling));
  const maxV = Math.max(...jpegData.components.map(c => c.verticalSampling));

  // Convert block grids to component planes
  const componentPlanes = componentGrids.map((grid, index) => {
    const comp = jpegData.components[index];
    return blocksToComponent(
      grid as number[][][], // We know it's fully populated
      jpegData.width,
      jpegData.height,
      comp.horizontalSampling,
      comp.verticalSampling,
      maxH,
      maxV
    );
  });

  // Combine components to RGB
  const yComponent = componentPlanes[0];
  const cbComponent = componentPlanes[1] || null;
  const crComponent = componentPlanes[2] || null;

  const rgbaData = combineComponents(
    yComponent,
    cbComponent,
    crComponent,
    jpegData.width,
    jpegData.height,
  );

  return {
    data: rgbaData,
    width: jpegData.width,
    height: jpegData.height
  };
}

function decodeScanData(
  bitStream: BitStream,
  jpegData: JPEGData,
  dcDecoders: Map<number, HuffmanDecoder>,
  acDecoders: Map<number, HuffmanDecoder>
): (number[] | null)[][][] {
  const maxH = Math.max(...jpegData.components.map(c => c.horizontalSampling));
  const maxV = Math.max(...jpegData.components.map(c => c.verticalSampling));

  const mcuWidth = maxH * 8;
  const mcuHeight = maxV * 8;

  const mcuCountX = Math.ceil(jpegData.width / mcuWidth);
  const mcuCountY = Math.ceil(jpegData.height / mcuHeight);

  const dcPredictions: number[] = new Array(jpegData.components.length).fill(0);
  let mcusBeforeRestart = jpegData.restartInterval || 0;

  // Pre-allocate block grids for each component
  const componentBlockGrids: (number[] | null)[][][] = jpegData.components.map((c) =>
    Array.from({ length: mcuCountY * c.verticalSampling }, () =>
      new Array<number[] | null>(mcuCountX * c.horizontalSampling).fill(null)
    )
  );

  for (let mcuY = 0; mcuY < mcuCountY; mcuY++) {
    for (let mcuX = 0; mcuX < mcuCountX; mcuX++) {
      // Handle restart markers
      if (jpegData.restartInterval && mcusBeforeRestart === 0) {
        bitStream.alignToByte();

        // Consume the restart marker (0xFF 0xD0..0xD7)
        const markerStart = bitStream.peekByte();
        if (markerStart === 0xFF) {
          bitStream.skipByte();
          const markerType = bitStream.peekByte();
          if (markerType !== null && markerType >= 0xD0 && markerType <= 0xD7) {
            bitStream.skipByte();
          }
        }

        mcusBeforeRestart = jpegData.restartInterval;
        dcPredictions.fill(0);
      }

      // Decode MCU (Minimum Coded Unit)
      for (const compId of jpegData.scanComponentIds) {
        const compIndex = jpegData.components.findIndex(c => c.id === compId);
        if (compIndex === -1) {
          throw new Error(`Component ID ${compId} in scan not found in frame`);
        }
        const component = jpegData.components[compIndex];
        const dcDecoder = dcDecoders.get(component.huffmanTableDC);
        const acDecoder = acDecoders.get(component.huffmanTableAC);
        const qTable = jpegData.quantizationTables.get(component.quantizationTableId)?.table;

        if (!dcDecoder || !acDecoder || !qTable) {
          throw new Error(`Missing tables for component ${compId}`);
        }

        // Components in an MCU are interleaved
        for (let y = 0; y < component.verticalSampling; y++) {
          for (let x = 0; x < component.horizontalSampling; x++) {
            const block = decodeBlock(
              bitStream,
              qTable,
              dcDecoder,
              acDecoder,
              dcPredictions,
              compIndex
            );

            const gridY = mcuY * component.verticalSampling + y;
            const gridX = mcuX * component.horizontalSampling + x;
            componentBlockGrids[compIndex][gridY][gridX] = block;
          }
        }
      }

      if (jpegData.restartInterval) {
        mcusBeforeRestart--;
      }
    }
  }

  return componentBlockGrids;
}

function decodeBlock(
  bitStream: BitStream,
  quantizationTable: Uint16Array,
  dcDecoder: HuffmanDecoder,
  acDecoder: HuffmanDecoder,
  dcPredictions: number[],
  componentIndex: number
): number[] {
  // Decode DC coefficient
  const dcCategory = dcDecoder.decode(bitStream);
  let dcDiff = 0;
  if (dcCategory > 0) {
    const dcBits = bitStream.readBits(dcCategory);
    dcDiff = receiveHuffmanValue(dcBits, dcCategory);
  }
  dcPredictions[componentIndex] += dcDiff;

  const zigzagBlock: number[] = new Array(64).fill(0);
  zigzagBlock[0] = dcPredictions[componentIndex];

  // Decode AC coefficients
  let index = 1;
  while (index < 64) {
    const acValue = acDecoder.decode(bitStream);

    if (acValue === 0x00) { // EOB
      break;
    }

    const runLength = (acValue >> 4) & 0x0F;
    const acCategory = acValue & 0x0F;

    index += runLength;

    if (index >= 64) {
      break;
    }

    if (acCategory > 0) {
      const acBits = bitStream.readBits(acCategory);
      zigzagBlock[index] = receiveHuffmanValue(acBits, acCategory);
    }
    index++;
  }

  // Dequantization
  for (let i = 0; i < 64; i++) {
    zigzagBlock[i] *= quantizationTable[i];
  }

  // Zigzag to Natural
  const naturalBlock = zigzagToNatural(zigzagBlock);

  // Inverse DCT
  return inverseDCT(naturalBlock);
}

function receiveHuffmanValue(bits: number, category: number): number {
  const threshold = 1 << (category - 1);
  if (bits < threshold) {
    return bits - ((1 << category) - 1);
  } else {
    return bits;
  }
}