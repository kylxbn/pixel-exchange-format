# Pixel Exchange Format CLI

CLI for PXF, exposing all features supported by the PXF codec library.

## Usage

```bash
pxf <command> [options] <arguments>
pxf --version      # CLI version and the codec version it was built with
```

All output files are written to the current working directory unless `-o` is given.
Existing files are never overwritten unless `-f, --force` is passed.

### `encode` - Encode data into images

```bash
pxf encode <source> [options]
```

`<source>` is a WAV file (PCM 8/16/24/32-bit or IEEE float, including
WAVE_FORMAT_EXTENSIBLE) or any other file. WAV files are encoded as audio; anything
else as binary. A WAV file that fails to parse is an error; use `--binary` to encode it
as raw data instead.

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Output image path (default: `<basename>.png`) |
| `-n, --name <name>` | Filename to embed in metadata (default: source basename) |
| `-c, --comment <text>` | Comment to embed in metadata |
| `-m, --metadata <key=value>` | Extra metadata entry; repeatable. The value may contain `=` |
| `-b, --binary` | Force binary mode, even for WAV input |
| `-f, --force` | Overwrite existing output files |

When the data does not fit in one image (stereo audio, or large files) a numbered set
is written: `<basename>_1.png`, `<basename>_2.png`, ... (with `-o out.png`:
`out_1.png`, `out_2.png`, ...). Decode by passing all images of the set together.

```bash
pxf encode song.wav -m album="Some Album" -m artist="Me"
pxf encode backup.tar.gz -n backup.tar.gz -c "Weekly backup" -o backup.png
pxf encode weird.wav --binary
```

### `decode` - Decode images back to data

```bash
pxf decode <sources...> [options]
```

Accepts PNG, JPEG, GIF, BMP, WebP and TIFF. Images from the same encode are grouped and
reassembled automatically, so order does not matter. Baseline JPEGs go through the bundled
PXF-tuned decoder; everything else (and any JPEG it rejects) goes through sharp.

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Output file path |
| `-i, --info` | Print format version and metadata only, without decoding |
| `-v, --verbose` | Print per-row and overall data health (binary only) |
| `-f, --force` | Overwrite an existing output file |

Default output paths: audio is written as 16-bit PCM to `<first source basename>_decoded.wav`;
binary data is written to the filename embedded in the metadata (reduced to its basename),
falling back to `<first source basename>_decoded.bin`.

```bash
pxf decode song_1.png song_2.png            # stereo set -> song_1_decoded.wav
pxf decode encoded.png -o output.wav
pxf decode backup.png -v                    # -> backup.tar.gz, with health stats
pxf decode encoded.jpg --info
```

### `check` - Validate images

```bash
pxf check <sources...>
```

Decodes binary images without writing any output and prints the checksum result plus
per-row data health. Exits with status 1 if the checksum does not match (and on any other
error), so it can be used in scripts. Audio images are currently reported as unsupported.

```bash
pxf check backup.png && echo "intact"
```

## License

BSD 3-Clause License (BSD-3-Clause). See `LICENSE`.

Unless otherwise noted, all source code in this repository is licensed under the BSD 3-Clause License.
