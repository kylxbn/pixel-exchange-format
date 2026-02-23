<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
  let { 
    label, 
    value, 
    percent, 
    colorClass = 'bg-primary-500', 
    labelClass = 'text-gray-400', 
    valueClass = 'text-gray-400',
  } = $props();
</script>

<div class="grid grid-cols-1 gap-1 my-0.5">
	<div class="flex items-baseline gap-1 justify-between xs">
		<span class={`${labelClass}`}>{label}</span>
		<span class={`font-mono ${valueClass}`}>{value}</span>
	</div>
	<div class="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden min-w-10">
		<div
			class={`h-full ${colorClass}`}
			style={`width: ${Math.min(100, Math.max(0, percent))}%`}
		></div>
	</div>
</div>
