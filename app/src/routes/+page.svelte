<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { localizeRoute } from '$lib/navigation';

	if (browser) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- locale-prefixed paths are not in the typed Pathname union
		goto(localizeRoute('/decode'), { replaceState: true });
	}
</script>
