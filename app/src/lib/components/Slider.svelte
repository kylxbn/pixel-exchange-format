<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
  let { 
    min = 0, 
    max = 100, 
    step = 1, 
    value = $bindable(0), 
    disabled = false,
    label = '',
    class: className = '',
    ...props
  } = $props();

  function handleChange(e: Event) {
    if (disabled) return;
    const target = e.target as HTMLInputElement;
    value = parseFloat(target.value);
    
    // Call original oninput if provided in props
    if (props.oninput) {
       (props.oninput as any)(e);
    }
  }

  let percent = $derived(((value - min) / (max - min)) * 100);
</script>

<div
	class={`relative flex items-center w-full h-6 group ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
>
	<!-- Track Background -->
	<div class="absolute w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
		<!-- Fill -->
		<div
			class="h-full bg-primary-600 transition-[width] duration-75 ease-out group-hover:bg-primary-500"
			style={`width: ${percent}%`}
		></div>
	</div>

	<!-- Native Input (for interaction) -->
	<input
		type="range"
		{min}
		{max}
		{step}
		{value}
		{disabled}
		{...props}
		oninput={handleChange}
		aria-label={label}
		class="absolute w-full h-full opacity-0 cursor-pointer z-10"
	/>

	<!-- Custom Thumb (Visual Only) -->
	<div
		class="absolute h-3.5 w-3.5 bg-white rounded-full shadow-md pointer-events-none transition-transform duration-75 ease-out group-hover:scale-110 group-active:scale-95"
		style={`left: ${percent}%; transform: translateX(-50%);`}
	>
		<div class="absolute inset-0 rounded-full ring-1 ring-black/10"></div>
	</div>
</div>
