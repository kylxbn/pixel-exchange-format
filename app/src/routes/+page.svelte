<!--
SPDX-License-Identifier: BSD-3-Clause
Copyright (c) 2026 Kyle Alexander Buan
-->

<script lang="ts">
    import { browser } from '$app/environment';
    import { goto } from '$app/navigation';

    if (browser) {
        goto('/decode', { replaceState: true });
    }
</script>
