<script lang="ts">
	import { asset } from '$app/paths';

	const links = {
		app: 'https://pxf.kylxbn.com',
		repo: 'https://github.com/kylxbn/pixel-exchange-format'
	};

	const heroFacts = [
		'Version 300 format',
		'1024 px fixed image width',
		'Audio + arbitrary binary payloads',
		'Web app, CLI, specification, desktop build support'
	];

	const audienceCards = [
		{
			eyebrow: 'For humans',
			title: 'Files become images you can inspect, move around, and decode later.',
			copy: 'PXF is easiest to explain as a visual transport format. A WAV file, a MIDI file, or another binary payload becomes one or more images with enough structure to reconstruct the original data later.'
		},
		{
			eyebrow: 'For engineers',
			title: 'A deterministic codec with a written specification.',
			copy: 'The repository includes an explicit format spec, a TypeScript reference implementation, and test coverage for end-to-end encode/decode, multi-image reassembly, metadata roundtrips, and binary integrity checks.'
		},
		{
			eyebrow: 'For tinkerers',
			title: 'An odd format idea, taken seriously.',
			copy: 'PXF is not a steganography project. It has a dedicated audio path, a separate binary path, error correction, integrity checks, and a custom JPEG decoder tuned for the kinds of damage this format cares about.'
		}
	];

	const formatRows = [
		['Row 0', 'LDPC-protected header stream with version, mode, payload size, metadata length, grouping salt, and image sequence info'],
		['Row 1', 'Human-readable text row plus header hash data'],
		['Rows 2+', 'Audio payload rows or binary payload rows, depending on channel mode']
	];

	const technicalHighlights = [
		'Audio uses 256-sample MDCT windows with a 128-sample hop.',
		'Only 96 coefficients are stored directly; the top 32 bins are reconstructed with row-level SBR side data.',
		'Stereo is encoded as mid/side image pairs, not left/right channels.',
		'Binary mode stores 2480 bytes per row across 124 data blocks.',
		'Header, row metadata, and binary payload use LDPC-based correction at different code rates.',
		'Binary rows also carry CRC32C so decode can report whether recovered data is trustworthy.',
		'The codec uses deterministic whitening and permutation so the encoder and decoder stay bit-compatible.',
		'There is a custom JPEG decoder because typical chroma upsampling choices are bad for PXF.'
	];

	const audioDetails = [
		'Mid/side stereo payloads become paired images with deterministic odd/even indexing, and the mid image remains decodable even if the side image is missing.',
		'Row metadata stores scaling values, band factors, and 8 bytes of SBR information.',
		'The decoder supports metadata-first loading and progressive audio decoding through a streaming decoder.'
	];

	const binaryDetails = [
		'Each block carries 16 bytes of 2-bit luma symbols plus 2 bytes each for 1-bit Cb and Cr.',
		'Rows are permuted at the 2-bit-pair level after parity generation, so burst errors get scattered before correction.',
		'The CLI can also report row-by-row health for binary payloads.'
	];

	const surfaces = [
		{
			name: 'Web app',
			copy: 'Browser-based encoder and decoder with image previews, metadata-first loading, audio playback, and special handling for audio, binary payloads, and MIDI files.',
			href: links.app
		},
		{
			name: 'CLI',
			copy: 'A pxf command with encode, decode, and binary-check flows for local files.',
			href: `${links.repo}/blob/main/cli`
		},
		{
			name: 'Desktop',
			copy: 'The app is already wired for Tauri builds, so the codec is not limited to the browser.',
			href: `${links.repo}/tree/main/app`
		},
		{
			name: 'Specification',
			copy: 'A generated public specification for clean-room implementations and format study.',
			href: `${links.repo}/blob/main/codec/SPECIFICATION.md`
		},
	];

	const proofPoints = [
		'Repository tests cover mono audio, stereo audio, binary payloads, metadata constraints, multi-image reconstruction, and decoder edge cases.',
		'The format documentation is assembled from module-level markdown in the codec source tree.',
		'Experimental notes in the repository document why particular implementation decisions were made.'
	];

	const screenshotGallery = [
		{
			src: asset('/media/encode.webp'),
			alt: 'PXF encoder interface showing a stereo WAV encoded into two image parts.',
			label: 'Encode',
			title: 'A stereo WAV becomes two image parts'
		},
		{
			src: asset('/media/decode_audio.webp'),
			alt: 'PXF decoder interface displaying recovered audio and audio inspection details.',
			label: 'Decode audio',
			title: 'The decoder can inspect and play audio payloads'
		},
		{
			src: asset('/media/decode_file.webp'),
			alt: 'PXF decoder interface displaying a decoded binary file with metadata and an audio preview.',
			label: 'Decode binary',
			title: 'Binary payloads surface metadata, integrity, and previews'
		},
		{
			src: asset('/media/decode_midi.webp'),
			alt: 'PXF decoder interface displaying a decoded MIDI file inside the built-in MIDI player.',
			label: 'Decode MIDI',
			title: 'MIDI payloads get a dedicated player view'
		}
	];
</script>

<svelte:head>
	<title>Pixel Exchange Format</title>
	<meta
		name="description"
		content="Pixel Exchange Format encodes audio and arbitrary files into images using a documented codec with error correction, integrity checks, a web app, and a CLI."
	/>
	<meta
		name="keywords"
		content="Pixel Exchange Format, PXF, image codec, audio in images, binary in images, LDPC, SBR, metadata, CLI, SvelteKit"
	/>
	<meta property="og:title" content="Pixel Exchange Format" />
	<meta
		property="og:description"
		content="An experimental image-native transport format for audio and binary data."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:url" content={links.repo} />
</svelte:head>

<div class="min-h-screen border-t border-black/70">
	<header class="border-b border-black/70">
		<div
			class="mx-auto flex w-full max-w-368 items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8"
		>
			<div class="flex items-center gap-3">
				<img
					src={asset('/favicon/favicon.png')}
					alt="Pixel Exchange Format"
					width="24"
					height="24"
					class="h-6 w-6 object-contain"
				/>
			</div>
			<nav class="hidden gap-6 text-sm text-black/70 md:flex">
				<a href="#format" class="transition-colors hover:text-black">Format</a>
				<a href="#screens" class="transition-colors hover:text-black">Screens</a>
				<a href="#technical" class="transition-colors hover:text-black">Technical</a>
				<a href="#surfaces" class="transition-colors hover:text-black">Surfaces</a>
			</nav>
			<div class="flex items-center gap-2 text-sm">
				<a
					href={links.app}
					target="_blank"
					rel="noreferrer"
					class="border border-black px-3 py-2 transition-colors hover:bg-black hover:text-(--paper)"
				>
					Web app
				</a>
				<a
					href={links.repo}
					target="_blank"
					rel="noreferrer"
					class="border border-black/20 px-3 py-2 text-black/72 transition-colors hover:border-black hover:text-black"
				>
					GitHub
				</a>
			</div>
		</div>
	</header>

	<main>
		<section class="border-b border-black/70">
			<div class="mx-auto grid w-full max-w-368 gap-8 px-4 py-8 sm:px-6 md:py-12 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-16">
				<div class="flex flex-col gap-8">
					<div class="space-y-6">
						<p class="text-xs font-medium uppercase  text-(--accent)">
							Experimental image transport for audio and files
						</p>
						<div class="space-y-4">
							<h1 class="max-w-4xl text-5xl font-semibold uppercase leading-[0.92]  sm:text-6xl lg:text-7xl">
								An experiment in making data survive JPEG.
							</h1>
							<p class="max-w-2xl text-base leading-7 text-black/74 sm:text-lg">
								Pixel Exchange Format is an open codec and toolchain for encoding audio or arbitrary
								binary data into fixed-width images. It uses deterministic transforms, error
								correction, and integrity checks so the images can be decoded back into the original
								payload later.
							</p>
						</div>
						<div class="flex flex-wrap gap-3">
							<a
								href={links.app}
								target="_blank"
								rel="noreferrer"
								class="border border-black bg-black px-4 py-3 text-sm font-medium uppercase  text-(--paper) transition-colors hover:bg-(--accent) hover:text-black"
							>
								Open the web app
							</a>
							<a
								href={`${links.repo}/blob/main/codec/SPECIFICATION.md`}
								target="_blank"
								rel="noreferrer"
								class="border border-black px-4 py-3 text-sm font-medium uppercase  transition-colors hover:bg-black hover:text-(--paper)"
							>
								Read the specification
							</a>
						</div>
					</div>

					<div class="grid gap-px border border-black bg-black sm:grid-cols-2 xl:grid-cols-4">
						{#each heroFacts as fact (fact)}
							<div class="bg-(--paper) px-4 py-4 text-sm leading-6 text-black/72">
								{fact}
							</div>
						{/each}
					</div>

					<div class="grid gap-px border border-black bg-black lg:grid-cols-3">
						{#each audienceCards as card (card.title)}
							<article class="flex flex-col gap-4 bg-(--paper) p-5">
								<p class="text-xs font-medium uppercase  text-(--accent)">
									{card.eyebrow}
								</p>
								<h2 class="text-xl font-semibold leading-tight ">
									{card.title}
								</h2>
								<p class="text-sm leading-6 text-black/70">{card.copy}</p>
							</article>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-4">
					<div class="border border-black bg-black p-2">
						<img
							src={asset('/media/passport.webp')}
							alt="Top band of an audio file encoded as a PXF frame."
							width="2048"
							height="256"
							fetchpriority="high"
							class="block h-auto w-full border border-black/70 bg-(--paper) object-cover"
						/>
					</div>
					<div class="border border-black bg-black p-2">
						<img
							src={asset('/media/christmas.webp')}
							alt="Top band of a MIDI file encoded as a PXF frame."
							width="2048"
							height="256"
							class="block h-auto w-full border border-black/70 bg-(--paper) object-cover"
						/>
					</div>
					<div class="border border-black bg-black p-5">
						<p class="text-xs font-medium uppercase  text-(--accent)">
							What you are looking at
						</p>
						<p class="mt-4 text-sm leading-6 text-(--paper)/82">
							Those two narrow strips are not decorative banners. They are the visible top sections of
							real PXF images: one carrying audio, one carrying MIDI data. In PXF, the image is the
							container.
						</p>
					</div>
				</div>
			</div>
		</section>

		<section id="format" class="border-b border-black/70">
			<div class="mx-auto grid w-full max-w-368 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-16">
				<div class="space-y-5">
					<p class="text-xs font-medium uppercase  text-(--accent)">
						What PXF actually is
					</p>
					<h2 class="text-3xl font-semibold uppercase leading-none  sm:text-4xl">
						PXF is not steganography.
					</h2>
					<p class="text-base leading-7 text-black/72">
						PXF treats the image as a structured transport layer. It has a format version, explicit
						channel modes, deterministic seeds, metadata packing rules, a documented row layout, and
						separate encode/decode pipelines for audio and binary payloads.
					</p>
					<p class="text-base leading-7 text-black/72">
						The result is a format that is visual enough to inspect directly, but specific enough to
						describe in terms of constants, code rates, row metadata, and clean-room implementation
						targets.
					</p>
				</div>

				<div class="grid gap-px border border-black bg-black lg:grid-cols-[0.72fr_1.28fr]">
					<div class="bg-(--paper) p-5">
						<p class="text-xs font-medium uppercase  text-black/48">Image layout</p>
						<dl class="mt-5 space-y-5">
							{#each formatRows as [term, description] (term)}
								<div class="border-t border-black/15 pt-4">
									<dt class="text-sm font-medium uppercase  text-black">{term}</dt>
									<dd class="mt-2 text-sm leading-6 text-black/70">{description}</dd>
								</div>
							{/each}
						</dl>
					</div>
					<div class="bg-(--paper) p-5">
						<p class="text-xs font-medium uppercase  text-black/48">Core format facts</p>
						<div class="mt-5 grid gap-px border border-black bg-black sm:grid-cols-2">
							<div class="bg-(--paper) p-4">
								<p class="text-xs uppercase  text-black/50">Image width</p>
								<p class="mt-2 font-mono text-2xl">1024 px</p>
							</div>
							<div class="bg-(--paper) p-4">
								<p class="text-xs uppercase  text-black/50">Block size</p>
								<p class="mt-2 font-mono text-2xl">8 × 8</p>
							</div>
							<div class="bg-(--paper) p-4">
								<p class="text-xs uppercase  text-black/50">Header code</p>
								<p class="mt-2 font-mono text-2xl">8192 / 6144</p>
							</div>
							<div class="bg-(--paper) p-4">
								<p class="text-xs uppercase  text-black/50">Binary row code</p>
								<p class="mt-2 font-mono text-2xl">20064 / 19840</p>
							</div>
						</div>
						<div class="mt-5 border border-black/15 p-4">
							<p class="text-xs font-medium uppercase  text-black/48">
								One-line description
							</p>
							<p class="mt-3 text-sm leading-6 text-black/72">
								PXF is an image format for transporting audio and binary data with deterministic
								encoding, LDPC-backed recovery, and row-level integrity checks.
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>

		<section id="screens" class="border-b border-black/70">
			<div class="mx-auto w-full max-w-368 px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
				<div class="grid gap-6 lg:grid-cols-[0.65fr_1.35fr]">
					<div class="space-y-5">
						<p class="text-xs font-medium uppercase  text-(--accent)">
							The app in practice
						</p>
						<h2 class="text-3xl font-semibold uppercase leading-none  sm:text-4xl">
							The browser app is part of the repository.
						</h2>
						<p class="text-base leading-7 text-black/72">
							The repository includes a browser app. It can encode files to PNG, pass them
							directly into the decoder flow, load image metadata first, stream decoded audio, inspect
							binary payloads, and hand MIDI files to a built-in player view.
						</p>
						<p class="text-base leading-7 text-black/72">
							These screenshots are from the actual toolchain, not a mockup.
						</p>
					</div>

					<div class="grid gap-px border border-black bg-black md:grid-cols-2">
						{#each screenshotGallery as shot, index (shot.src)}
							<figure class="bg-(--paper) p-3">
								<img
									src={shot.src}
									alt={shot.alt}
									width="1280"
									height="938"
									loading={index < 2 ? 'eager' : 'lazy'}
									class="block h-auto w-full border border-black object-cover"
								/>
								<figcaption class="border-x border-b border-black px-4 py-3">
									<p class="text-xs font-medium uppercase  text-(--accent)">
										{shot.label}
									</p>
									<p class="mt-2 text-sm leading-6 text-black/72">{shot.title}</p>
								</figcaption>
							</figure>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section id="technical" class="border-b border-black/70">
			<div class="mx-auto w-full max-w-368 px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
				<div class="grid gap-8 lg:grid-cols-2">
					<article class="border border-black bg-(--paper)">
						<div class="border-b border-black px-5 py-4">
							<p class="text-xs font-medium uppercase  text-(--accent)">
								Audio mode
							</p>
							<h3 class="mt-3 text-2xl font-semibold uppercase ">
								A dedicated path for audio, not generic bytes in a wrapper
							</h3>
						</div>
						<div class="grid gap-6 p-5">
							<img
								src={asset('/media/passport.webp')}
								alt="Stereo WAV encoded into a PXF container"
								width="2048"
								height="256"
								loading="lazy"
								class="block h-auto w-full border border-black object-cover"
							/>
							<div class="grid gap-px border border-black bg-black sm:grid-cols-3">
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">Window size</p>
									<p class="mt-2 font-mono text-xl">256 samples</p>
								</div>
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">
										Samples per row
									</p>
									<p class="mt-2 font-mono text-xl">15,872 samples</p>
								</div>
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">Stored bins</p>
									<p class="mt-2 font-mono text-xl">96 + SBR</p>
								</div>
							</div>
							<p class="text-sm leading-6 text-black/72">
								Audio uses 256-sample windows with a 128-sample hop. Stereo is represented as
								mid/side image pairs. The stored image payload covers 96 coefficients per block, while
								the top 32 bins are reconstructed from compact row-level SBR side data during decode.
							</p>
							<ul class="space-y-3 border-t border-black/15 pt-4 text-sm leading-6 text-black/72">
								{#each audioDetails as item (item)}
									<li>{item}</li>
								{/each}
							</ul>
						</div>
					</article>

					<article class="border border-black bg-(--paper)">
						<div class="border-b border-black px-5 py-4">
							<p class="text-xs font-medium uppercase  text-(--accent)">
								Binary mode
							</p>
							<h3 class="mt-3 text-2xl font-semibold uppercase ">
								A row-oriented binary transport with integrity checks
							</h3>
						</div>
						<div class="grid gap-6 p-5">
							<img
								src={asset('/media/christmas.webp')}
								alt="MIDI file encoded into a binary PXF container"
								width="2048"
								height="256"
								loading="lazy"
								class="block h-auto w-full border border-black object-cover"
							/>
							<div class="grid gap-px border border-black bg-black sm:grid-cols-3">
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">Per row</p>
									<p class="mt-2 font-mono text-xl">2480 bytes</p>
								</div>
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">Metadata tail</p>
									<p class="mt-2 font-mono text-xl">32 bytes</p>
								</div>
								<div class="bg-(--paper) p-4">
									<p class="text-xs uppercase  text-black/48">Integrity</p>
									<p class="mt-2 font-mono text-xl">LDPC + CRC32C</p>
								</div>
							</div>
							<p class="text-sm leading-6 text-black/72">
								Binary payloads are mapped into Y, Cb, and Cr symbol planes, then decoded using soft
								LLRs and LDPC. The implementation can also report row health, which helps show how
								much recovery depended on correction.
							</p>
							<ul class="space-y-3 border-t border-black/15 pt-4 text-sm leading-6 text-black/72">
								{#each binaryDetails as item (item)}
									<li>{item}</li>
								{/each}
							</ul>
						</div>
					</article>
				</div>
			</div>
		</section>

		<section class="border-b border-black/70">
			<div class="mx-auto grid w-full max-w-368 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-16">
				<div class="border border-black bg-black p-5 text-(--paper)">
					<p class="text-xs font-medium uppercase  text-(--accent)">
						Open format posture
					</p>
					<h2 class="mt-3 text-3xl font-semibold uppercase leading-none ">
						Documented enough to reimplement
					</h2>
					<p class="mt-5 text-sm leading-6 text-(--paper)/82">
						The codec specification is generated from module-level markdown inside `codec/src`.
						The implementation and the explanation are meant to stay in sync.
					</p>
					<div class="mt-6 border border-(--paper)/20 p-4 font-mono text-sm leading-7 text-(--paper)/82">
						<p>FORMAT_VERSION = 300</p>
						<p>IMAGE_WIDTH = 1024</p>
						<p>MDCT_HOP_SIZE = 128</p>
						<p>BINARY_ROW_DATA_CAPACITY = 2480</p>
						<p>CHANNEL_MODE = MONO | MID | SIDE | BINARY</p>
					</div>
				</div>

				<div class="space-y-6">
					<p class="text-base leading-7 text-black/72">
						The repo also contains notes and experiments around coefficient order, JPEG damage, and other
						implementation choices.
					</p>
					<div class="grid gap-px border border-black bg-black sm:grid-cols-3">
						<div class="bg-(--paper) p-4">
							<p class="text-xs uppercase  text-black/48">Coefficient study</p>
							<p class="mt-2 text-sm leading-6 text-black/72">
								We compare zigzag, Hilbert, and optimized coefficient orderings to see how JPEG
								distortion affects recovery.
							</p>
						</div>
						<div class="bg-(--paper) p-4">
							<p class="text-xs uppercase  text-black/48">JPEG probe</p>
							<p class="mt-2 text-sm leading-6 text-black/72">
								We measure channel distortion from a Facebook JPEG roundtrip and use that to tune the
								format.
							</p>
						</div>
						<div class="bg-(--paper) p-4">
							<p class="text-xs uppercase  text-black/48">Custom JPEG decoder</p>
							<p class="mt-2 text-sm leading-6 text-black/72">
								The repository includes a custom JPEG decoder for the chroma handling choices PXF
								cares about, because default decoder behavior was not always good enough for
								recovery.
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>

		<section id="surfaces" class="border-b border-black/70">
			<div class="mx-auto w-full max-w-368 px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
				<div class="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
					<div class="space-y-5">
						<p class="text-xs font-medium uppercase  text-(--accent)">
							What ships in this repository
						</p>
						<h2 class="text-3xl font-semibold uppercase leading-none  sm:text-4xl">
							Several ways to inspect the format
						</h2>
						<p class="text-base leading-7 text-black/72">
							The repo exposes the codec in a few forms: browser app, CLI, generated specification,
							and a Tauri-ready desktop wrapper.
						</p>
					</div>
					<div class="grid gap-px border border-black bg-black md:grid-cols-2">
						{#each surfaces as surface (surface.name)}
							<a
								href={surface.href}
								target="_blank"
								rel="noreferrer"
								class="group bg-(--paper) p-5 transition-colors hover:bg-black hover:text-(--paper)"
							>
								<p class="text-xs font-medium uppercase  text-(--accent)">
									{surface.name}
								</p>
								<p class="mt-3 text-base font-medium leading-6">{surface.copy}</p>
							</a>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section class="border-b border-black/70">
			<div class="mx-auto grid w-full max-w-368 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:px-8 lg:py-16">
				<div class="space-y-5">
					<p class="text-xs font-medium uppercase  text-(--accent)">
						Automated tests
					</p>
					<h2 class="text-3xl font-semibold uppercase leading-none  sm:text-4xl">
						The test suite covers the important cases.
					</h2>
				</div>
				<div class="grid gap-px border border-black bg-black">
					{#each proofPoints as point (point)}
						<div class="bg-(--paper) px-5 py-5 text-sm leading-6 text-black/74">
							{point}
						</div>
					{/each}
				</div>
			</div>
		</section>

		<section class="py-10 sm:py-14 lg:py-18">
			<div class="mx-auto w-full max-w-368 px-4 sm:px-6 lg:px-8">
				<div class="grid gap-px border border-black bg-black lg:grid-cols-[1.1fr_0.9fr]">
					<div class="bg-(--paper) p-6 sm:p-8">
						<h2 class="mt-4 text-4xl font-semibold uppercase leading-[0.94]  sm:text-5xl">
							The experiment, implementation, and specification are all public.
						</h2>
					</div>
					<div class="bg-(--paper) p-6 sm:p-8">
						<div class="grid gap-3 text-sm">
							<a
								href={links.app}
								target="_blank"
								rel="noreferrer"
								class="border border-black bg-black px-4 py-4 text-center font-medium uppercase  text-(--paper) transition-colors hover:bg-(--accent) hover:text-black"
							>
								Open web app
							</a>
							<a
								href={links.repo}
								target="_blank"
								rel="noreferrer"
								class="border border-black px-4 py-4 text-center font-medium uppercase  transition-colors hover:bg-black hover:text-(--paper)"
							>
								Browse repository
							</a>
							<a
								href={`${links.repo}/blob/main/codec/SPECIFICATION.md`}
								target="_blank"
								rel="noreferrer"
								class="border border-black px-4 py-4 text-center font-medium uppercase  transition-colors hover:bg-black hover:text-(--paper)"
							>
								Read specification
							</a>
						</div>
						<p class="mt-5 text-xs uppercase  text-black/46">
							Open source under BSD-3-Clause.
						</p>
					</div>
				</div>
			</div>
		</section>
	</main>
</div>
