<script lang="ts">
	import { asset } from '$app/paths';

	const links = {
		app: 'https://pxf.kylxbn.com',
		repo: 'https://github.com/kylxbn/pixel-exchange-format'
	};

	
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
