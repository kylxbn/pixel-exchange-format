// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export interface QuantizationTable {
  id: number;
  table: Uint16Array;
}

export interface HuffmanTable {
  id: number;
  tableClass: number; // 0 = DC, 1 = AC
  codeCounts: Uint8Array;
  values: Uint8Array;
}

export interface ComponentInfo {
  id: number;
  horizontalSampling: number;
  verticalSampling: number;
  quantizationTableId: number;
  huffmanTableDC: number;
  huffmanTableAC: number;
}

export interface JPEGData {
  width: number;
  height: number;
  components: ComponentInfo[];
  quantizationTables: Map<number, QuantizationTable>;
  huffmanTablesDC: Map<number, HuffmanTable>;
  huffmanTablesAC: Map<number, HuffmanTable>;
  scanData: Uint8Array;
  scanComponentIds: number[];
  restartInterval?: number;
}

// Standard Huffman Tables from JPEG Spec Annex K
const STD_HUFFMAN_TABLES = {
  LUMA_DC: {
    id: 0, tableClass: 0,
    codeCounts: new Uint8Array([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]),
    values: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  },
  CHROMA_DC: {
    id: 1, tableClass: 0,
    codeCounts: new Uint8Array([0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]),
    values: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  },
  LUMA_AC: {
    id: 0, tableClass: 1,
    codeCounts: new Uint8Array([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125]),
    values: new Uint8Array([
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
      0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
      0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
      0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
      0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
      0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
      0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
      0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
      0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
      0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
      0xf9, 0xfa
    ])
  },
  CHROMA_AC: {
    id: 1, tableClass: 1,
    codeCounts: new Uint8Array([0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119]),
    values: new Uint8Array([
      0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
      0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
      0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
      0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
      0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
      0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
      0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
      0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
      0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
      0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
      0xf9, 0xfa
    ])
  }
};

export function parseJPEG(data: Uint8Array): JPEGData {
  let offset = 0;

  // Check SOI
  if (data[offset] !== 0xFF || data[offset + 1] !== 0xD8) {
    throw new Error('Invalid JPEG file: missing SOI marker');
  }
  offset += 2;

  const quantizationTables = new Map<number, QuantizationTable>();
  const huffmanTablesDC = new Map<number, HuffmanTable>();
  const huffmanTablesAC = new Map<number, HuffmanTable>();
  let width = 0;
  let height = 0;
  let components: ComponentInfo[] = [];
  let restartInterval: number | undefined;
  let scanData: Uint8Array | null = null;
  let scanComponentIds: number[] = [];

  while (offset < data.length) {
    if (data[offset] !== 0xFF) {
      throw new Error(`Invalid JPEG marker at offset ${offset}: 0x${data[offset].toString(16)}`);
    }

    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xD9) { // EOI
      break;
    }

    const length = (data[offset] << 8) | data[offset + 1];
    // Length includes its own 2 bytes
    const nextMarkerOffset = offset + length;

    switch (marker) {
      case 0xC0: // SOF0 (Start of Frame - Baseline)
        ({ width, height, components } = parseSOF(data, offset + 2));
        break;
      case 0xC1: // SOF1 (Extended Sequential)
      case 0xC2: // SOF2 (Progressive)
      case 0xC3: // SOF3 (Lossless)
        throw new Error(`Unsupported JPEG SOF marker 0x${marker.toString(16)}. Only Baseline (SOF0) is supported.`);
      case 0xC4: // DHT (Define Huffman Table)
        parseDHT(data, offset + 2, length - 2).forEach(table => {
          if (table.tableClass === 0) huffmanTablesDC.set(table.id, table);
          else huffmanTablesAC.set(table.id, table);
        });
        break;
      case 0xDB: // DQT (Define Quantization Table)
        parseDQT(data, offset + 2, length - 2).forEach(table => {
          quantizationTables.set(table.id, table);
        });
        break;
      case 0xDD: // DRI (Define Restart Interval)
        restartInterval = (data[offset + 2] << 8) | data[offset + 3];
        break;
      case 0xDA: // SOS (Start of Scan)
        const sosInfo = parseSOSHeader(data, offset + 2);
        scanComponentIds = sosInfo.components.map(c => c.id);
        // Map Huffman tables to components
        sosInfo.components.forEach(sosComp => {
          const comp = components.find(c => c.id === sosComp.id);
          if (comp) {
            comp.huffmanTableDC = sosComp.huffmanTableDC;
            comp.huffmanTableAC = sosComp.huffmanTableAC;
          }
        });

        // Scan data starts after the SOS header
        const headerLength = (data[offset] << 8) | data[offset + 1];
        const scanStart = offset + headerLength;
        scanData = findScanData(data, scanStart);
        // Skip to end of scan data
        offset = scanStart + scanData.length;
        continue; // offset is already advanced correctly
      default:
        // Skip unknown markers
        break;
    }

    offset = nextMarkerOffset;
  }

  if (!scanData) {
    throw new Error('No scan data found in JPEG');
  }

  // Provide standard huffman tables as fallback if none were defined
  // Standard IDs are 0 for Luma, 1 for Chroma
  if (!huffmanTablesDC.has(0)) huffmanTablesDC.set(0, STD_HUFFMAN_TABLES.LUMA_DC);
  if (!huffmanTablesDC.has(1)) huffmanTablesDC.set(1, STD_HUFFMAN_TABLES.CHROMA_DC);
  if (!huffmanTablesAC.has(0)) huffmanTablesAC.set(0, STD_HUFFMAN_TABLES.LUMA_AC);
  if (!huffmanTablesAC.has(1)) huffmanTablesAC.set(1, STD_HUFFMAN_TABLES.CHROMA_AC);

  return {
    width,
    height,
    components,
    quantizationTables,
    huffmanTablesDC,
    huffmanTablesAC,
    scanData,
    scanComponentIds,
    restartInterval
  };
}

function parseSOF(data: Uint8Array, offset: number) {
  const precision = data[offset];
  const height = (data[offset + 1] << 8) | data[offset + 2];
  const width = (data[offset + 3] << 8) | data[offset + 4];
  const numComponents = data[offset + 5];

  const components: ComponentInfo[] = [];
  for (let i = 0; i < numComponents; i++) {
    const compOffset = offset + 6 + i * 3;
    const id = data[compOffset];
    const sampling = data[compOffset + 1];
    const quantizationTableId = data[compOffset + 2];

    components.push({
      id,
      horizontalSampling: sampling >> 4,
      verticalSampling: sampling & 0x0F,
      quantizationTableId,
      huffmanTableDC: 0, // Will be set by SOS
      huffmanTableAC: 0  // Will be set by SOS
    });
  }

  return { width, height, components };
}

function parseDQT(data: Uint8Array, offset: number, length: number): QuantizationTable[] {
  const tables: QuantizationTable[] = [];
  let pos = offset;
  const end = offset + length;

  while (pos < end) {
    const info = data[pos++];
    const tableId = info & 0x0F;
    const precision = info >> 4;

    const table = new Uint16Array(64);
    for (let i = 0; i < 64; i++) {
      if (precision === 0) {
        table[i] = data[pos++];
      } else {
        table[i] = (data[pos] << 8) | data[pos + 1];
        pos += 2;
      }
    }
    tables.push({ id: tableId, table });
  }

  return tables;
}

function parseDHT(data: Uint8Array, offset: number, length: number): HuffmanTable[] {
  const tables: HuffmanTable[] = [];
  let pos = offset;
  const end = offset + length;

  while (pos < end) {
    const info = data[pos++];
    const tableId = info & 0x0F;
    const tableClass = info >> 4;

    const codeCounts = new Uint8Array(16);
    let totalValues = 0;
    for (let i = 0; i < 16; i++) {
      codeCounts[i] = data[pos++];
      totalValues += codeCounts[i];
    }

    const values = new Uint8Array(totalValues);
    for (let i = 0; i < totalValues; i++) {
      values[i] = data[pos++];
    }

    tables.push({ id: tableId, tableClass, codeCounts, values });
  }

  return tables;
}

function parseSOSHeader(data: Uint8Array, offset: number) {
  const numComponents = data[offset];
  const components = [];
  for (let i = 0; i < numComponents; i++) {
    const id = data[offset + 1 + i * 2];
    const huffmanTables = data[offset + 2 + i * 2];
    components.push({
      id,
      huffmanTableDC: huffmanTables >> 4,
      huffmanTableAC: huffmanTables & 0x0F
    });
  }
  return { components };
}

function findScanData(data: Uint8Array, startOffset: number): Uint8Array {
  let endOffset = startOffset;
  while (endOffset < data.length - 1) {
    if (data[endOffset] === 0xFF) {
      const nextByte = data[endOffset + 1];
      if (nextByte === 0x00) {
        // Stuffed byte, skip
        endOffset += 2;
        continue;
      } else if (nextByte >= 0xD0 && nextByte <= 0xD7) {
        // Restart marker, keep going
        endOffset += 2;
        continue;
      } else {
        // New marker (e.g. SOS, EOI), end of scan data
        break;
      }
    }
    endOffset++;
  }
  return data.slice(startOffset, endOffset);
}
