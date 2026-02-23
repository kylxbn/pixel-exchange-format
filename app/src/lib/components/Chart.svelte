<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
  import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Legend
  } from 'chart.js';

  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Legend
  );

  let { type, data, options } = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!canvas) return;
    
    const chartInstance = new Chart(canvas, { type, data, options });

    chartInstance.data = data;
    chartInstance.options = options;
    chartInstance.update('none');
    
    return () => chartInstance.destroy();
  });

</script>

<div class="relative w-full h-full">
	<canvas bind:this={canvas}></canvas>
</div>
