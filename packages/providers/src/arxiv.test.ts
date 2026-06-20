import { describe, it, expect } from "vitest";
import { parseArxivFeed, parseEntry } from "./arxiv.js";

// A trimmed but structurally faithful arxiv Atom feed: two entries, the first
// with an affiliation + DOI, the second without (the common case).
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
    expect(p.links.source).toBe("https://arxiv.org/e-print/2301.12345");
  });

  it("captures authors and omits affiliation when absent (no undefined)", () => {
    const [p] = parseArxivFeed(FEED);
    expect(p.authors[0]).toEqual({ name: "Jane Doe", affiliation: "MIT" });
    expect(p.authors[1]).toEqual({ name: "John Roe" });
    expect("affiliation" in p.authors[1]).toBe(false);
  });

  it("returns [] for a feed with no entries", () => {
    expect(parseArxivFeed("<feed></feed>")).toEqual([]);
  });
});

describe("parseEntry", () => {
  it("returns null when there is no id", () => {
    expect(parseEntry("<entry><title>x</title></entry>")).toBeNull();
  });
});
