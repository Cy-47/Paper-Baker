import { describe, it, expect } from "vitest";
import {
  slugify,
  uniqueProjectId,
  generateStableId,
  isValidStableId,
  STABLE_ID_LENGTH,
  STABLE_ID_ALPHABET,
} from "./project-id.js";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("My Research")).toBe("my-research");
  });

  it("collapses surrounding and repeated whitespace/separators", () => {
    expect(slugify("  Spaced   Out  ")).toBe("spaced-out");
    expect(slugify("Foo_Bar Baz")).toBe("foo-bar-baz");
    expect(slugify("a - b")).toBe("a-b");
    expect(slugify("a---b")).toBe("a-b");
  });

  it("drops punctuation", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("C++ vs Rust")).toBe("c-vs-rust");
  });

  it("strips leading/trailing hyphens", () => {
    expect(slugify("-foo-")).toBe("foo");
    expect(slugify("!!!foo!!!")).toBe("foo");
  });

  it("strips diacritics to ASCII", () => {
    expect(slugify("Café Déjà")).toBe("cafe-deja");
  });

  it("keeps CJK and other non-Latin letters rather than stripping them", () => {
    expect(slugify("机器学习")).toBe("机器学习");
    expect(slugify("已经")).toBe("已经");
    expect(slugify("深度学习 2024")).toBe("深度学习-2024");
    expect(slugify("研究 Notes")).toBe("研究-notes");
  });

  it("returns empty string when nothing slug-able remains", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
    expect(slugify("🎉🎉🎉")).toBe("");
  });

  it("caps length at 64 chars without a trailing hyphen", () => {
    const out = slugify("a".repeat(200));
    expect(out.length).toBe(64);
    const out2 = slugify("word ".repeat(40));
    expect(out2.length).toBeLessThanOrEqual(64);
    expect(out2.endsWith("-")).toBe(false);
  });
});

describe("uniqueProjectId", () => {
  it("returns the base when it is free", () => {
    expect(uniqueProjectId("my-project", [])).toBe("my-project");
    expect(uniqueProjectId("my-project", ["other"])).toBe("my-project");
  });

  it("suffixes from -2 upward on collision", () => {
    expect(uniqueProjectId("my-project", ["my-project"])).toBe("my-project-2");
    expect(uniqueProjectId("my-project", ["my-project", "my-project-2"])).toBe(
      "my-project-3",
    );
  });

  it("accepts a Set of taken ids", () => {
    expect(uniqueProjectId("p", new Set(["p", "p-2"]))).toBe("p-3");
  });

  it("falls back to 'untitled' for an empty base", () => {
    expect(uniqueProjectId("", [])).toBe("untitled");
    expect(uniqueProjectId("", ["untitled"])).toBe("untitled-2");
  });
});

describe("generateStableId", () => {
  it("produces ids of the configured length from the alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateStableId();
      expect(id.length).toBe(STABLE_ID_LENGTH);
      for (const ch of id) {
        expect(STABLE_ID_ALPHABET).toContain(ch);
      }
    }
  });

  it("is deterministic given an injected index source", () => {
    // randomIndex(maxExclusive) is asked for one index per character.
    let i = 0;
    const id = generateStableId(() => i++ % STABLE_ID_ALPHABET.length);
    let expected = "";
    for (let j = 0; j < STABLE_ID_LENGTH; j++) {
      expected += STABLE_ID_ALPHABET[j % STABLE_ID_ALPHABET.length];
    }
    expect(id).toBe(expected);
  });

  it("uses an unambiguous alphabet (no 0/1/l/o)", () => {
    expect(STABLE_ID_ALPHABET).not.toContain("0");
    expect(STABLE_ID_ALPHABET).not.toContain("1");
    expect(STABLE_ID_ALPHABET).not.toContain("l");
    expect(STABLE_ID_ALPHABET).not.toContain("o");
  });
});

describe("isValidStableId", () => {
  it("accepts generated ids", () => {
    expect(isValidStableId(generateStableId())).toBe(true);
  });

  it("rejects wrong length or out-of-alphabet characters", () => {
    expect(isValidStableId("ab23")).toBe(false); // not 8 chars
    expect(isValidStableId("a".repeat(9))).toBe(false);
    expect(isValidStableId("ab0o2345")).toBe(false); // 0 and o aren't in the alphabet
    expect(isValidStableId("")).toBe(false);
  });
});
