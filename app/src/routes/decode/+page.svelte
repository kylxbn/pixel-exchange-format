<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import Decoder from '$lib/components/Decoder.svelte';
    import { transferState } from '$lib/transfer.svelte';
</script>

<Decoder initialFiles={transferState.files} onFilesProcessed={() => transferState.clear()} />
