// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { base } from '$app/paths';
import { localizeHref } from '$lib/paraglide/runtime';

export function localizeRoute(path: string, options?: Parameters<typeof localizeHref>[1]): string {
	return `${base}${localizeHref(path, options)}`;
}
