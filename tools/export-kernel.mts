#!/usr/bin/env node
// tools/export-kernel.mts -- retired in 4.8.0 (DECISIONS 239).
//
// From 4.8.0 src/core/kernel.ts is itself a vendored copy of cli-kernel's
// src/kernel.ts, exported from a signed cli-kernel tag. Its source of truth
// and its export tool live in cli-kernel now:
//
//   node <cli-kernel>/tools/export.mts <tag> <dest-file> [--check]
//   node <cli-kernel>/tools/export.mts --check <dest-file>
//
// This file stays as a pointer so that a script or a habit calling it gets
// that sentence instead of "module not found". It writes nothing and always
// exits 2. Releases up to 4.7.1 still carry the old exporter in their own
// tree (`git show v4.7.1:tools/export-kernel.mts`).

process.stderr.write(
  'export-kernel: retired in nanojira 4.8.0: src/core/kernel.ts is a vendored copy of cli-kernel (DECISIONS 239).\n' +
  'export-kernel: export the kernel from a cli-kernel checkout instead:\n' +
  'export-kernel:   node <cli-kernel>/tools/export.mts <tag> <dest-file> [--check]\n' +
  'export-kernel:   node <cli-kernel>/tools/export.mts --check <dest-file>\n',
);
process.exit(2);
