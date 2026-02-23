<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
  type ButtonVariant = 'primary' | 'secondary' | 'danger';
  
  let { 
    children, 
    disabled = false, 
    variant = 'secondary', 
    onclick = () => {}, 
    class: className = '',
    ...props 
  } = $props();

  const variants = {
    primary: 'bg-primary-600 hover:bg-primary-500 text-white shadow-md hover:shadow-lg hover:shadow-primary-500/20 border border-transparent',
    secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 hover:border-gray-600 shadow-sm hover:shadow-md',
    danger: 'bg-red-900/50 hover:bg-red-900/80 text-red-200 border border-red-900/50 hover:border-red-800 focus:ring-red-500'
  };
</script>

<button
	{disabled}
	{...props}
	class={`
    inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md
    transition-all duration-150 ease-out select-none
    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:ring-primary-500
    disabled:opacity-50 disabled:cursor-not-allowed
    ${!disabled ? 'active:scale-95' : ''}
    ${variants[variant as ButtonVariant]}
    ${className}
  `}
	onclick={(e) => {
		if (!disabled) onclick(e);
	}}
>
	{@render children()}
</button>
