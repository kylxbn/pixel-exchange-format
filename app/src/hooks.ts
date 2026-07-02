// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { Reroute } from '@sveltejs/kit';
import { base } from '$app/paths';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

export const reroute: Reroute = (request) => {
    const url = new URL(request.url);

    if (base && url.pathname.startsWith(base)) {
        url.pathname = url.pathname.slice(base.length) || '/';
        return `${base}${deLocalizeUrl(url).pathname}`;
    }

    return deLocalizeUrl(url).pathname;
};

export const transport = undefined;
