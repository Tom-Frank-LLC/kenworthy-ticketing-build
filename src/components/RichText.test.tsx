import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from '@/components/RichText';

/**
 * The unit tests in src/lib/richText.test.ts prove the sanitiser returns the
 * right string. These prove the component actually puts that string on the
 * page — the step where `dangerouslySetInnerHTML` is involved, and the one
 * worth pinning, because `/host` lets an external event organiser write to the
 * columns this renders.
 */

describe('RichText', () => {
  it('renders formatting as real elements, not as visible tags', () => {
    const { container } = render(
      <RichText html="<p>A <strong>restored</strong> print.</p><ul><li>35mm</li></ul>" />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('restored');
    expect(container.querySelector('ul li')?.textContent).toBe('35mm');
    expect(container.textContent).not.toContain('<strong>');
  });

  it('renders a legacy plain-text row as paragraphs', () => {
    const { container } = render(<RichText html={'One.\n\nTwo.'} />);
    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['One.', 'Two.']);
  });

  it('renders nothing at all when there is nothing to say', () => {
    const { container } = render(<RichText html={null} />);
    expect(container.firstChild).toBeNull();
    // An emptied editor stores `<p></p>`; that must not print an empty box.
    expect(render(<RichText html="<p></p>" />).container.firstChild).toBeNull();
  });

  it('does not execute or mount a script from a stored description', () => {
    const { container } = render(
      <RichText html={'<p>Before</p><script>window.__xss = true;</script><p>After</p>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
    expect(container.textContent).toContain('Before');
  });

  it('drops an event handler smuggled in on an allowed tag', () => {
    const { container } = render(<RichText html={'<p onclick="alert(1)">Hi</p>'} />);
    expect(container.querySelector('p')?.getAttribute('onclick')).toBeNull();
  });

  it('neutralises a javascript: link but keeps the words around it', () => {
    render(<RichText html={'<p><a href="javascript:alert(1)">Click me</a></p>'} />);
    const link = screen.getByText('Click me');
    expect(link.getAttribute('href')).toBeNull();
  });

  it('gives an external link the attributes that make a new tab safe', () => {
    render(<RichText html={'<p><a href="https://example.com">Elsewhere</a></p>'} />);
    const link = screen.getByText('Elsewhere');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps the caller’s typography and adds the structural class', () => {
    const { container } = render(
      <RichText html="<p>x</p>" className="text-sm text-muted-foreground" />,
    );
    const root = container.firstElementChild!;
    // The site sets size and colour per slot; this component only adds structure.
    expect(root.className).toContain('rich-text');
    expect(root.className).toContain('text-sm');
  });
});
