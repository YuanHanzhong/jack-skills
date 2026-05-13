import { describe, expect, test } from 'bun:test';

import { generateFrontMatter } from './web-fetcher.js';

describe('web-fetcher frontmatter', () => {
  test('includes source provenance and sha256 for ODS health checks', () => {
    const frontmatter = generateFrontMatter({
      title: 'Example',
      url: 'https://example.com/post',
      author: '',
      description: '',
    }, 'article', 'body text');

    expect(frontmatter).toContain('source_url: https://example.com/post');
    expect(frontmatter).toContain('ingested:');
    expect(frontmatter).toContain('sha256:');
  });
});
