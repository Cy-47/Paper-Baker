#!/usr/bin/env node
// Cross-compile the CLI into standalone binaries for every supported platform.
// Each binary embeds the Node 22 runtime, so end users need no Node installed.
//
// Output names follow `pb-<os>-<arch>` so install.sh can map `uname` directly.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const NODE = "node22";
const OUT_DIR = "binaries";

// [pkg target platform, pkg target arch, output os, output arch, extension]
const TARGETS = [
  ["macos", "arm64", "darwin", "arm64", ""],
  ["macos", "x64", "darwin", "x64", ""],
  ["linux", "x64", "linux", "x64", ""],
  ["linux", "arm64", "linux", "arm64", ""],
  ["win", "x64", "windows", "x64", ".exe"],
];

mkdirSync(OUT_DIR, { recursive: true });

for (const [pkgOs, pkgArch, os, arch, ext] of TARGETS) {
  const target = `${NODE}-${pkgOs}-${pkgArch}`;
  const output = `${OUT_DIR}/pb-${os}-${arch}${ext}`;
  console.log(`\n▶ Building ${output}  (${target})`);
  execFileSync(
    "pkg",
    [
      "dist/index.cjs",
      "--targets",
      target,
      // Cross-architecture targets (e.g. arm64 from an x64 runner) can't have
      // V8 bytecode generated — pkg would need to execute a Node of the foreign
      // arch, which fails with "no source or bytecode" at runtime. --no-bytecode
      // embeds the JS source instead, so every target builds on one x64 runner.
      // --public silences the accompanying "not public" warnings.
      "--no-bytecode",
      "--public",
      "--output",
      output,
    ],
    { stdio: "inherit", shell: true }
  );
}

console.log("\n✓ All binaries built in ./binaries");
