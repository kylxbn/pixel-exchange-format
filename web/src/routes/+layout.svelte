<script lang="ts">
	import { asset } from '$app/paths';
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={asset('/favicon/favicon.png')} /></svelte:head>
{@render children()}
