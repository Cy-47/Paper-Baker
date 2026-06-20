import { describe, it, expect } from "vitest";
import {
  assetName,
  downloadUrl,
  normalizeVersion,
  stripEnvLines,
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

describe("downloadUrl", () => {
  it("builds a GitHub release download URL for the asset", () => {
    expect(downloadUrl("v0.2.0", "pb-darwin-arm64")).toBe(
      "https://github.com/Cy-47/Paper-Baker/releases/download/v0.2.0/pb-darwin-arm64",
    );
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
