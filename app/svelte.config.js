import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.BASE_PATH ?? '';
const entries = base ? [] : ['/', '/decode', '/encode', '/ja', '/ja/decode', '/ja/encode'];

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			fallback: 'app.html'
		}),
		prerender: {
			entries,
			handleUnseenRoutes: base ? 'ignore' : 'fail'
		},
		paths: {
			base,
			relative: false
		}
	}
};

export default config;
