import { describe, expect, it } from 'vitest';
import {
  htmlToPlainText,
  isRichTextEmpty,
  looksLikeHtml,
  plainTextToHtml,
  sanitizeRichText,
  toMetaDescription,
  toRichHtml,
} from '@/lib/richText';

describe('looksLikeHtml', () => {
  it('recognises editor output', () => {
    expect(looksLikeHtml('<p>A restored print.</p>')).toBe(true);
    expect(looksLikeHtml('Playing <strong>one night</strong> only')).toBe(true);
  });

  it('does not mistake prose containing angle brackets for markup', () => {
    expect(looksLikeHtml('Doors at 7 < curtain at 7:30')).toBe(false);
    expect(looksLikeHtml('A film about <the future>')).toBe(false);
  });

  it('is false for the legacy plain text already in the column', () => {
    expect(looksLikeHtml('One line.\n\nAnother line.')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
    expect(looksLikeHtml(null)).toBe(false);
  });
});

describe('plainTextToHtml', () => {
  it('starts a paragraph at a blank line, matching backstageParagraphs', () => {
    expect(plainTextToHtml('One.\n\nTwo.\n\n\nThree.')).toBe(
      '<p>One.</p><p>Two.</p><p>Three.</p>',
    );
  });

  it('keeps a single newline as a line break, matching whitespace-pre-line', () => {
    expect(plainTextToHtml('One,\nstill one.')).toBe('<p>One,<br>still one.</p>');
  });

  it('escapes text that would otherwise become markup', () => {
    expect(plainTextToHtml('Tickets < $10 & worth it')).toBe(
      '<p>Tickets &lt; $10 &amp; worth it</p>',
    );
  });

  it('is empty for nothing at all', () => {
    expect(plainTextToHtml('   \n\n  ')).toBe('');
    expect(plainTextToHtml(null)).toBe('');
  });
});

describe('sanitizeRichText', () => {
  it('keeps the formatting the toolbar can produce', () => {
    const html =
      '<h3>The print</h3><p><strong>Bold</strong> and <em>italic</em>.</p>' +
      '<ul><li>One</li></ul><ol><li>Two</li></ol><blockquote>Quoted</blockquote><hr>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('drops a script tag', () => {
    expect(sanitizeRichText('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('drops an image with an onerror handler', () => {
    const out = sanitizeRichText('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('strips a javascript: href but keeps the words', () => {
    const out = sanitizeRichText('<p><a href="javascript:alert(1)">Click me</a></p>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('Click me');
  });

  it('strips a data: href', () => {
    const out = sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain('data:');
  });

  it('drops style and event attributes from allowed tags', () => {
    const out = sanitizeRichText('<p style="position:fixed" onclick="alert(1)">Hi</p>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('opens an external link in a new tab, safely', () => {
    const out = sanitizeRichText('<a href="https://example.com">Site</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('does not blank-tab a mailto or an internal link', () => {
    expect(sanitizeRichText('<a href="mailto:box@kenworthy.org">Mail</a>')).not.toContain(
      'target',
    );
    expect(sanitizeRichText('<a href="/film-passes">Passes</a>')).not.toContain('target');
  });

  it('overrides a target the stored markup tried to set itself', () => {
    const out = sanitizeRichText('<a href="/x" target="_blank" rel="opener">x</a>');
    expect(out).not.toContain('target');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('toRichHtml', () => {
  it('passes editor HTML through the allowlist', () => {
    expect(toRichHtml('<p>Kept</p><script>no</script>')).toBe('<p>Kept</p>');
  });

  it('converts a legacy plain-text row to paragraphs', () => {
    expect(toRichHtml('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
  });

  it('is empty for a blank value', () => {
    expect(toRichHtml('  ')).toBe('');
    expect(toRichHtml(null)).toBe('');
  });

  // Non-obvious, and worth pinning: a value made *only* of tags that are not on
  // the allowlist does not look like our markup, so it takes the legacy
  // plain-text path and is escaped rather than sanitised. Either route is safe
  // — this one shows the characters as text instead of dropping them, which is
  // the right outcome for a pre-editor row that happened to mention a tag.
  it('escapes markup built entirely from disallowed tags instead of running it', () => {
    const out = toRichHtml('<img src=x onerror="alert(1)">');
    expect(out).toContain('&lt;img');
    expect(out).not.toMatch(/<img/i);
  });

  it('sanitises rather than escapes as soon as one allowed tag is present', () => {
    expect(toRichHtml('<p>Hi</p><img src=x onerror="alert(1)">')).toBe('<p>Hi</p>');
  });
});

describe('htmlToPlainText', () => {
  it('separates blocks with a space rather than joining the words', () => {
    expect(htmlToPlainText('<p>One.</p><p>Two.</p>')).toBe('One. Two.');
    expect(htmlToPlainText('<ul><li>A</li><li>B</li></ul>')).toBe('A B');
  });

  it('drops inline formatting without eating the words', () => {
    expect(htmlToPlainText('<p>A <strong>restored</strong> print</p>')).toBe(
      'A restored print',
    );
  });

  it('decodes entities without re-creating markup', () => {
    expect(htmlToPlainText('<p>Tickets &lt; $10 &amp; worth it</p>')).toBe(
      'Tickets < $10 & worth it',
    );
    // The author escaped this deliberately; it must stay text, not become a tag.
    expect(htmlToPlainText('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;');
  });

  it('leaves legacy plain text readable', () => {
    expect(htmlToPlainText('One.\n\nTwo.')).toBe('One. Two.');
  });

  it('is empty for nothing', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText('<p></p>')).toBe('');
  });
});

describe('isRichTextEmpty', () => {
  it('treats the editor’s empty paragraph as empty', () => {
    expect(isRichTextEmpty('<p></p>')).toBe(true);
    expect(isRichTextEmpty('<p><br></p>')).toBe(true);
    expect(isRichTextEmpty('')).toBe(true);
    expect(isRichTextEmpty(null)).toBe(true);
  });

  it('treats any real copy as non-empty', () => {
    expect(isRichTextEmpty('<p>A</p>')).toBe(false);
    expect(isRichTextEmpty('plain text')).toBe(false);
  });
});

describe('toMetaDescription', () => {
  it('never returns markup', () => {
    const meta = toMetaDescription('<p>A <strong>restored</strong> 35mm print.</p>');
    expect(meta).toBe('A restored 35mm print.');
    expect(meta).not.toContain('<');
  });

  it('truncates long copy on a word boundary', () => {
    const meta = toMetaDescription(`<p>${'word '.repeat(60)}</p>`, 40);
    expect(meta.length).toBeLessThanOrEqual(40);
    expect(meta.endsWith('…')).toBe(true);
    expect(meta).not.toMatch(/wor…$/);
  });

  it('leaves short copy alone', () => {
    expect(toMetaDescription('<p>Short.</p>', 160)).toBe('Short.');
  });
});
