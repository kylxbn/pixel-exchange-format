<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
  let { children } = $props();
</script>

<div class="bg-gray-800 border border-gray-700 rounded p-4 shadow-sm">
	{@render children()}
</div>
