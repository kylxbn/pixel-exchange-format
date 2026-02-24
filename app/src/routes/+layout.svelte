<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import './app.css';
    import { page } from '$app/state';
    import * as m from '$lib/paraglide/messages';
    import { getLocale, locales, setLocale, localizeHref, deLocalizeHref } from '$lib/paraglide/runtime';
	import { VERSION } from '@pixel-exchange-format/codec';
    
    let { children } = $props();
    
    let activePath = $derived(deLocalizeHref(page.url.pathname));

    function isActive(path: string) {
        if (path === '/decode' && (activePath === '/decode' || activePath === '/')) return true;
        return activePath === path;
    }
</script>

<div class="h-screen w-screen flex flex-col bg-gray-900 text-gray-300 overflow-hidden font-sans">
	<!-- Header Toolbar -->
	<header
		class="h-12 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 flex items-center justify-between px-4 shrink-0 select-none z-50 shadow-sm sticky top-0"
	>
		<!-- Left: Logo -->
		<div class="flex items-center gap-3 w-64">
			<div class="w-6 h-6 flex items-center justify-center">
				<img
					class="w-full h-full object-contain filter drop-shadow-sm"
					src="/favicon/favicon.png"
					alt={m.app_name()}
				/>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-base font-semibold tracking-wide text-gray-100 uppercase opacity-90"
					>{m.app_name()}</span
				>
				<span class="text-xs">v{VERSION}</span>
			</div>
		</div>

		<!-- Center: Mode Switcher -->
		<nav class="flex items-center justify-center flex-1">
			<div class="flex items-center bg-gray-900/50 rounded p-1 border border-gray-700/50 gap-1">
				<a
					href={localizeHref('/decode')}
					class={`px-4 py-1 text-xs font-medium rounded transition-all duration-150 ${
						isActive('/decode')
							? 'bg-gray-800 text-white shadow-sm ring-1 ring-white/5'
							: 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
					}`}
				>
					{m.nav_decode()}
				</a>
				<div class="w-px h-3 bg-gray-700/50"></div>
				<a
					href={localizeHref('/encode')}
					class={`px-4 py-1 text-xs font-medium rounded transition-all duration-150 ${
						isActive('/encode')
							? 'bg-gray-800 text-white shadow-sm ring-1 ring-white/5'
							: 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
					}`}
				>
					{m.nav_encode()}
				</a>
			</div>
		</nav>

		<!-- Right: Language & Tools -->
		<div class="flex items-center justify-end w-64 gap-2">
			<div
				class="flex items-center bg-gray-900/50 rounded border border-gray-700/50 overflow-hidden"
			>
				<button
					onclick={() => setLocale('en')}
					class={`px-2 py-1 text-xs font-bold uppercase transition-colors min-w-7.5 ${
						getLocale() === 'en'
							? 'bg-gray-700 text-white'
							: 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
					}`}
				>
					EN
				</button>
				<div class="w-px h-full bg-gray-700/50"></div>
				<button
					onclick={() => setLocale('ja')}
					class={`px-2 py-1 text-xs font-bold uppercase transition-colors min-w-7.5 ${
						getLocale() === 'ja'
							? 'bg-gray-700 text-white'
							: 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
					}`}
				>
					JA
				</button>
			</div>
		</div>
	</header>

	<main
		class="grow flex flex-col w-full h-[calc(100vh-3rem)] overflow-hidden relative bg-gray-900"
	>
		{@render children()}
	</main>
</div>

<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })} data-sveltekit-reload>{locale}</a>
	{/each}
</div>
