import { describe, it, expect } from "vitest";
import { parseArxivFeed, parseArxivEntry } from "./arxiv-parse.js";

// A trimmed but structurally faithful arxiv Atom feed: two entries, the first
// with an affiliation + DOI, the second without (the common case). This is the
// shared parser used by BOTH the on-device provider and the Cloud Functions
// backend, so these assertions pin the behavior both rely on.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v2</id>
    <updated>2023-03-01T00:00:00Z</updated>
    <published>2023-01-15T00:00:00Z</published>
    <title>Attention   Routing in
      Sparse Models</title>
    <summary>  We study sparse routing.  </summary>
    <author><name>Jane Doe</name><arxiv:affiliation>MIT</arxiv:affiliation></author>
    <author><name>John Roe</name></author>
    <arxiv:doi>10.1234/xyz</arxiv:doi>
    <link href="http://arxiv.org/abs/2301.12345v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.12345v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="cs.LG"/>
    <category term="cs.LG"/>
    <category term="cs.AI"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2105.00001v1</id>
    <published>2021-05-01T00:00:00Z</published>
    <title>A Second Paper</title>
    <summary>Another abstract.</summary>
    <author><name>Ada Lovelace</name></author>
    <link href="http://arxiv.org/abs/2105.00001v1" rel="alternate" type="text/html"/>
    <arxiv:primary_category term="math.NA"/>
    <category term="math.NA"/>
  </entry>
</feed>`;

describe("parseArxivFeed", () => {
  it("parses every entry in the feed", () => {
    expect(parseArxivFeed(FEED)).toHaveLength(2);
  });

  it("normalizes the first entry", () => {
    const [p] = parseArxivFeed(FEED);
    expect(p.paperId).toBe("arxiv:2301.12345"); // version stripped
    expect(p.source).toEqual({ type: "arxiv", id: "2301.12345" });
    expect(p.title).toBe("Attention Routing in Sparse Models"); // whitespace collapsed
    expect(p.abstract).toBe("We study sparse routing.");
    expect(p.publishedAt).toBe("2023-01-15T00:00:00Z");
    expect(p.updatedAt).toBe("2023-03-01T00:00:00Z");
    expect(p.doi).toBe("10.1234/xyz");
    expect(p.categories).toEqual(["cs.LG", "cs.AI"]); // primary first, deduped
    expect(p.links.pdf).toBe("http://arxiv.org/pdf/2301.12345v2");
    expect(p.links.abs).toBe("http://arxiv.org/abs/2301.12345v2");
    expect(p.links.source).toBe("https://arxiv.org/e-print/2301.12345"); // stripped id
    expect(p.sourceStatus).toBe("available");
  });

  it("captures authors and omits affiliation when absent (no undefined)", () => {
    const [p] = parseArxivFeed(FEED);
    expect(p.authors[0]).toEqual({ name: "Jane Doe", affiliation: "MIT" });
    expect(p.authors[1]).toEqual({ name: "John Roe" });
    expect("affiliation" in p.authors[1]).toBe(false);
  });

  it("leaves optional fields undefined when the feed omits them", () => {
    const [, p] = parseArxivFeed(FEED);
    expect(p.doi).toBeUndefined();
    expect(p.updatedAt).toBeUndefined();
    expect(p.links.pdf).toBeUndefined(); // no <link title="pdf"> in this entry
  });

  it("returns [] for a feed with no entries", () => {
    expect(parseArxivFeed("<feed></feed>")).toEqual([]);
  });
});

describe("parseArxivEntry", () => {
  it("returns null when there is no id", () => {
    expect(parseArxivEntry("<entry><title>x</title></entry>")).toBeNull();
  });

  it("strips the version from the id but preserves it in feed-provided links", () => {
    const entry = `<entry>
      <id>http://arxiv.org/abs/2301.12345v3</id>
      <title>Versioned</title>
      <summary>s</summary>
      <link title="pdf" href="http://arxiv.org/pdf/2301.12345v3" rel="related"/>
    </entry>`;
    const p = parseArxivEntry(entry)!;
    expect(p.source.id).toBe("2301.12345");
    expect(p.paperId).toBe("arxiv:2301.12345");
    expect(p.links.pdf).toBe("http://arxiv.org/pdf/2301.12345v3");
  });

  it("supports old-style ids like hep-ph/0001234", () => {
    const entry = `<entry>
      <id>http://arxiv.org/abs/hep-ph/0001234v1</id>
      <title>Old style</title>
      <summary>s</summary>
    </entry>`;
    const p = parseArxivEntry(entry)!;
    expect(p.source.id).toBe("hep-ph/0001234");
    expect(p.paperId).toBe("arxiv:hep-ph/0001234");
  });

  it("defaults a nameless author to Unknown", () => {
    const entry = `<entry>
      <id>http://arxiv.org/abs/2301.00001v1</id>
      <title>t</title>
      <summary>s</summary>
      <author><arxiv:affiliation>Nowhere</arxiv:affiliation></author>
    </entry>`;
    const p = parseArxivEntry(entry)!;
    expect(p.authors[0]).toEqual({ name: "Unknown", affiliation: "Nowhere" });
  });

  it("falls back to the <id> url for the abs link when no alternate link exists", () => {
    const entry = `<entry>
      <id>http://arxiv.org/abs/2301.00002v1</id>
      <title>t</title>
      <summary>s</summary>
    </entry>`;
    const p = parseArxivEntry(entry)!;
    expect(p.links.abs).toBe("http://arxiv.org/abs/2301.00002v1");
  });
});
