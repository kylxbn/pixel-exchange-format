// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export class TransferState {
    files = $state<File[]>([]);

    transfer(files: File[]) {
        this.files = files;
    }

    clear() {
        this.files = [];
    }
}

export const transferState = new TransferState();
