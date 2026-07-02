<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import Encoder from '$lib/components/Encoder.svelte';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { transferState } from '$lib/transfer.svelte';

    function handleTransfer(files: File[]) {
        transferState.transfer(files);
        goto(resolve('/decode'));
    }
</script>

<div class="w-full h-full overflow-y-auto">
	<Encoder onTransfer={handleTransfer} />
</div>
