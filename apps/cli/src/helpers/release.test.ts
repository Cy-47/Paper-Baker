import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  assetName,
  downloadUrl,
  isNewer,
  normalizeVersion,
  stripEnvLines,
  swapBinary,
} from "./release.js";

describe("assetName", () => {
  it("maps each supported platform/arch to the release asset name", () => {
    expect(assetName("darwin", "arm64")).toBe("pb-darwin-arm64");
    expect(assetName("darwin", "x64")).toBe("pb-darwin-x64");
    expect(assetName("linux", "x64")).toBe("pb-linux-x64");
    expect(assetName("linux", "arm64")).toBe("pb-linux-arm64");
    expect(assetName("win32", "x64")).toBe("pb-windows-x64.exe");
  });

  it("matches the names build-binaries.mjs / install.sh produce", () => {
    // install.sh: asset="pb-${os}-${arch}", os in {darwin,linux}, arch in {arm64,x64}
    for (const platform of ["darwin", "linux"] as const) {
      for (const arch of ["arm64", "x64"]) {
        expect(assetName(platform, arch)).toBe(`pb-${platform}-${arch}`);
      }
    }
  });

  it("rejects unsupported OS / arch", () => {
    expect(() => assetName("freebsd" as NodeJS.Platform, "x64")).toThrow(/Unsupported OS/);
    expect(() => assetName("linux", "ia32")).toThrow(/Unsupported architecture/);
  });
});

describe("normalizeVersion", () => {
  it("strips a leading v so tags compare to package versions", () => {
    expect(normalizeVersion("v0.1.0")).toBe("0.1.0");
    expect(normalizeVersion("0.1.0")).toBe("0.1.0");
    expect(normalizeVersion("v1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });
});

describe("isNewer", () => {
  it("is true only for a strictly newer release", () => {
    expect(isNewer("v0.1.4", "0.1.3")).toBe(true);
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("blocks downgrades and same-version (no-op / anti-rollback)", () => {
    expect(isNewer("0.1.2", "0.1.3")).toBe(false); // downgrade
    expect(isNewer("0.1.3", "0.1.3")).toBe(false); // equal
    expect(isNewer("v0.1.3", "0.1.3")).toBe(false); // equal, tag form
  });

  it("treats a final release as newer than its prerelease, not vice versa", () => {
    expect(isNewer("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isNewer("1.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewer("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
  });

  it("never upgrades on an unparseable version", () => {
    expect(isNewer("garbage", "0.1.3")).toBe(false);
    expect(isNewer("0.1.4", "not-a-version")).toBe(false);
  });
});

describe("downloadUrl", () => {
  it("builds a GitHub release download URL for the asset", () => {
    expect(downloadUrl("v0.2.0", "pb-darwin-arm64")).toBe(
      "https://github.com/Cy-47/Paper-Baker/releases/download/v0.2.0/pb-darwin-arm64",
    );
  });
});

// swapBinary runs the candidate via `--version`, so the fake "binary" is a shell
// script — POSIX-only (Windows can't exec a shebang script the same way, and its
// rename-aside path is a separate branch).
describe.skipIf(process.platform === "win32")("swapBinary", () => {
  let dir: string;
  const fakeBinary = (version: string) => Buffer.from(`#!/bin/sh\necho "${version}"\n`);

  function setup(): string {
    dir = mkdtempSync(join(tmpdir(), "pb-swap-"));
    const target = join(dir, "pb");
    // Seed an existing install to be replaced.
    swapBinary(fakeBinary("0.0.1"), target);
    return target;
  }

  it("atomically replaces the target with a validated new binary", () => {
    const target = setup();
    try {
      const res = swapBinary(fakeBinary("1.2.3"), target);
      expect(res.oldPath).toBeUndefined(); // POSIX: in-place swap
      expect(readFileSync(target, "utf8")).toContain("1.2.3");
      // No temp leftovers in the directory.
      expect(readdirSync(dir).filter((f) => f.startsWith(".pb-update-"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a binary that won't run and leaves the existing install untouched", () => {
    const target = setup();
    try {
      // Not executable code — `--version` will fail.
      expect(() => swapBinary(Buffer.from("\x00\x01 not a program"), target)).toThrow(
        /failed to run/,
      );
      expect(readFileSync(target, "utf8")).toContain("0.0.1"); // original intact
      expect(readdirSync(dir).filter((f) => f.startsWith(".pb-update-"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs when the reported version matches the expected one", () => {
    const target = setup();
    try {
      expect(() =>
        swapBinary(fakeBinary("v2.0.0"), target, { expectedVersion: "2.0.0" }),
      ).not.toThrow();
      expect(readFileSync(target, "utf8")).toContain("2.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a signed downgrade: reported version != expected, install untouched", () => {
    const target = setup();
    try {
      // A validly-running binary that reports an OLDER version than the tag we
      // asked for — the signed-downgrade case. Must be refused.
      expect(() =>
        swapBinary(fakeBinary("0.0.1"), target, { expectedVersion: "2.0.0" }),
      ).toThrow(/reports v0\.0\.1, expected v2\.0\.0/);
      expect(readFileSync(target, "utf8")).toContain("0.0.1"); // original intact
      expect(readdirSync(dir).filter((f) => f.startsWith(".pb-update-"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the target when none exists yet", () => {
    dir = mkdtempSync(join(tmpdir(), "pb-swap-"));
    const target = join(dir, "pb");
    try {
      expect(existsSync(target)).toBe(false);
      swapBinary(fakeBinary("9.9.9"), target);
      expect(readFileSync(target, "utf8")).toContain("9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stripEnvLines", () => {
  const dir = "/home/u/.local/bin";

  it("removes the installer's source line, leaving the rest intact", () => {
    const before = ['# my rc', 'alias g=git', '', `. "${dir}/env"`, 'export FOO=1'].join("\n");
    const after = stripEnvLines(before, dir);
    expect(after).not.toContain(`${dir}/env`);
    expect(after).toContain("alias g=git");
    expect(after).toContain("export FOO=1");
  });

  it("also strips the fish env.fish source line (same dir prefix)", () => {
    const before = `source "${dir}/env.fish"\n`;
    expect(stripEnvLines(before, dir).trim()).toBe("");
  });

  it("is a no-op when no line references the install dir", () => {
    const before = "# nothing to see here\nexport PATH=/usr/bin\n";
    expect(stripEnvLines(before, dir)).toBe(before);
  });

  it("does not touch an unrelated tool's env line", () => {
    const before = `. "/opt/other/env"\n. "${dir}/env"\n`;
    const after = stripEnvLines(before, dir);
    expect(after).toContain('/opt/other/env');
    expect(after).not.toContain(`${dir}/env"`);
  });
});
