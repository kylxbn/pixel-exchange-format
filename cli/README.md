# Pixel Exchange Format CLI

CLI for PXF, exposing all features supported by the PXF codec library.

## Usage

### Basic Syntax

```bash
pxf <command> [options] <arguments>
```

### Commands

#### `encode` - Encode data into images

Encode audio or binary data into PXF image format.

**Syntax:**
```bash
pxf encode <source> [options]
```

**Arguments:**
- `<source>` - Source file (WAV audio or any binary file)

**Options:**
- `-o, --output <path>` - Output image path (default: `<source>.png`)
- `-n, --name <name>` - Custom filename to embed in metadata
- `-c, --comment <text>` - Optional comment to embed in metadata
- `-f, --force` - Overwrite existing output files

**Examples:**

Encode a WAV audio file:
```bash
pxf encode audio.wav
```

Encode with custom output path:
```bash
pxf encode audio.wav -o encoded_audio.png
```

Encode binary data with metadata:
```bash
pxf encode data.bin -n "myfile.bin" -c "Data backup"
```

Encode with custom name for embedded metadata:
```bash
pxf encode song.wav -n "Some song" -c "LOL"
```

#### `decode` - Decode images back to data

Decode PXF images back to audio or binary data.

**Syntax:**
```bash
pxf decode <sources...> [options]
```

**Arguments:**
- `<sources...>` - Source PXF image(s) - automatically recombines multiple images from the same file

**Options:**
- `-o, --output <path>` - Output file path (default: auto-generated from metadata)
- `-i, --info` - Display metadata information only, without decoding

**Examples:**

Decode a mono audio image:
```bash
pxf decode encoded_audio.png
```

Decode stereo audio from two images:
```bash
pxf decode left_channel.png right_channel.png
```

Decode with custom output path:
```bash
pxf decode encoded.png -o output.wav
```

Display metadata without decoding:
```bash
pxf decode encoded.png --info
```

Decode binary data:
```bash
pxf decode encoded_data.png
```

## License

BSD 3-Clause License (BSD-3-Clause). See `LICENSE`.

Unless otherwise noted, all source code in this repository is licensed under the BSD 3-Clause License.