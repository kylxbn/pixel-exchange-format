---
order: 26
title: Build Metadata
---

`buildInfo.ts` stores build-time version identifiers:

- `VERSION` (semantic release version)
- `BUILD_NUMBER` (incrementing build id)
- `BUILD_HASH` (short source hash)

In `codec/src/index.ts`, package-level `VERSION` is exported as:

`<VERSION>-<BUILD_HASH>`

This makes runtime version reporting deterministic for debugging and compatibility checks.
