<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
	import { m } from '$lib/paraglide/messages';
  import UploadIcon from './icons/UploadIcon.svelte';
  
  let { onChange, accept, label, disabled, multiple = false } = $props();
</script>

<label
	class={`
  flex flex-col items-center justify-center w-full h-32 px-4 
  border border-dashed border-gray-600 rounded
  cursor-pointer bg-gray-800/50 hover:bg-gray-800 hover:border-gray-500
  transition-all duration-200
  group
  ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}
`}
>
	<div
		class="flex flex-col items-center justify-center pt-5 pb-6 text-center"
	>
		<UploadIcon class="w-6 h-6 mb-2 text-gray-400 group-hover:text-gray-200" />
		<p class="text-sm font-medium text-gray-300 truncate max-w-full px-2">{label}</p>
		<p class="text-xs text-gray-500 mt-1 tracking-wider">{m.click_or_drop_file()}</p>
	</div>
	<input type="file" class="hidden" onchange={onChange} {accept} {disabled} {multiple} />
</label>
