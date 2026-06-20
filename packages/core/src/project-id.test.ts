import { describe, it, expect } from "vitest";
import {
  slugify,
  uniqueSlug,
  generateProjectId,
  isValidProjectId,
  PROJECT_ID_LENGTH,
  PROJECT_ID_ALPHABET,
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
    const out2 = slugify(("word ").repeat(40));
    expect(out2.length).toBeLessThanOrEqual(64);
    expect(out2.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("my-project", [])).toBe("my-project");
    expect(uniqueSlug("my-project", ["other"])).toBe("my-project");
  });

  it("suffixes from -2 upward on collision", () => {
    expect(uniqueSlug("my-project", ["my-project"])).toBe("my-project-2");
    expect(uniqueSlug("my-project", ["my-project", "my-project-2"])).toBe(
      "my-project-3",
    );
  });

  it("accepts a Set of taken slugs", () => {
    expect(uniqueSlug("p", new Set(["p", "p-2"]))).toBe("p-3");
  });

  it("falls back to 'untitled' for an empty base", () => {
    expect(uniqueSlug("", [])).toBe("untitled");
    expect(uniqueSlug("", ["untitled"])).toBe("untitled-2");
  });
});

describe("generateProjectId", () => {
  it("produces ids of the configured length from the alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateProjectId();
      expect(id.length).toBe(PROJECT_ID_LENGTH);
      for (const ch of id) {
        expect(PROJECT_ID_ALPHABET).toContain(ch);
      }
    }
  });

  it("is deterministic given an injected index source", () => {
    // randomIndex(maxExclusive) is asked for one index per character.
    const seq = [0, 1, 2, 3];
    let i = 0;
    const id = generateProjectId(() => seq[i++ % seq.length]);
    expect(id).toBe(
      PROJECT_ID_ALPHABET[0] +
        PROJECT_ID_ALPHABET[1] +
        PROJECT_ID_ALPHABET[2] +
        PROJECT_ID_ALPHABET[3],
    );
  });

  it("uses an unambiguous alphabet (no 0/1/l/o)", () => {
    expect(PROJECT_ID_ALPHABET).not.toContain("0");
    expect(PROJECT_ID_ALPHABET).not.toContain("1");
    expect(PROJECT_ID_ALPHABET).not.toContain("l");
    expect(PROJECT_ID_ALPHABET).not.toContain("o");
  });
});

describe("isValidProjectId", () => {
  it("accepts generated ids", () => {
    expect(isValidProjectId(generateProjectId())).toBe(true);
  });

  it("rejects wrong length or out-of-alphabet characters", () => {
    expect(isValidProjectId("abc")).toBe(false);
    expect(isValidProjectId("abcde")).toBe(false);
    expect(isValidProjectId("ab0o")).toBe(false);
    expect(isValidProjectId("")).toBe(false);
  });

  it("rejects local-* offline ids (those are not server ids)", () => {
    expect(isValidProjectId("local-1700000000000")).toBe(false);
  });
});
