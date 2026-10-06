import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

/**
 * What matters here is the contract with the forms, not ProseMirror's own
 * behaviour: legacy plain text has to load as paragraphs rather than as one
 * run-on line, an emptied field has to come back as '' so the forms keep
 * storing null, and the toolbar has to be reachable and announceable.
 */

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextEditor id="d" value={value} onChange={setValue} aria-label="Description" />
      <output data-testid="stored">{value}</output>
    </>
  );
}

describe('RichTextEditor', () => {
  // A toolbar command runs `focus()`, which scrolls the selection into view —
  // layout that jsdom's Range does not implement.
  beforeAll(() => {
    const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
    Range.prototype.getClientRects ??= (() => []) as unknown as Range['getClientRects'];
    Range.prototype.getBoundingClientRect ??= (() => rect) as unknown as Range['getBoundingClientRect'];
  });

  it('opens a legacy plain-text description as paragraphs', async () => {
    render(<Harness initial={'One.\n\nTwo.'} />);
    const box = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => {
      expect([...box.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
        'One.',
        'Two.',
      ]);
    });
  });

  it('loads existing markup without double-escaping it', async () => {
    render(<Harness initial="<p>A <strong>restored</strong> print.</p>" />);
    const box = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(box.querySelector('strong')?.textContent).toBe('restored'));
    expect(box.textContent).not.toContain('<strong>');
  });

  it('picks up a value that arrives after mount, as the admin forms do', async () => {
    // Every form here fetches its row and then setState()s — the editor mounts
    // against '' and must catch up when the real copy lands.
    function Late() {
      const [value, setValue] = useState('');
      return (
        <>
          <RichTextEditor value={value} onChange={setValue} aria-label="Description" />
          <button type="button" onClick={() => setValue('<p>Fetched copy.</p>')}>
            load
          </button>
        </>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByRole('button', { name: 'load' }));
    const box = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(box.textContent).toContain('Fetched copy.'));
  });

  it('exposes every toolbar control to a screen reader', async () => {
    render(<Harness />);
    const toolbar = await screen.findByRole('toolbar', { name: 'Text formatting' });
    expect(toolbar).toBeInTheDocument();
    for (const label of [
      'Bold',
      'Italic',
      'Sub-heading',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Add or edit link',
      'Divider',
      'Clear formatting',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('reports toggle state with aria-pressed rather than colour alone', async () => {
    render(<Harness initial="<p>text</p>" />);
    const bold = await screen.findByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
  });

  it('lights a toolbar button as soon as its mark is on', async () => {
    // TipTap 3 stopped re-rendering on every transaction; without
    // shouldRerenderOnTransaction the button would stay unpressed here.
    render(<Harness initial="<p>text</p>" />);
    const bold = await screen.findByRole('button', { name: 'Bold' });
    fireEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
  });

  it('stores what the author made — no empty paragraph appended after a closing heading', async () => {
    // TipTap 3's StarterKit adds TrailingNode, which appends an empty <p> after
    // any edit that leaves a heading, list or divider last.
    render(<Harness initial="<p>Notes</p>" />);
    await screen.findByRole('textbox', { name: 'Description' });
    fireEvent.click(screen.getByRole('button', { name: 'Sub-heading' }));
    await waitFor(() => expect(screen.getByTestId('stored').textContent).toBe('<h3>Notes</h3>'));
  });

  it('has no underline — TipTap 3 put it in the kit, but it is not on the render allowlist', async () => {
    // A load can't show this (toRichHtml strips <u> first); the keyboard can.
    render(<Harness initial="<p>under</p>" />);
    const box = await screen.findByRole('textbox', { name: 'Description' });
    box.focus();
    fireEvent.keyDown(box, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'u', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'b', ctrlKey: true });
    // Bold proves the shortcuts reached the editor; underline must not have.
    await waitFor(() => expect(screen.getByTestId('stored').textContent).toContain('<strong>'));
    expect(screen.getByTestId('stored').textContent).not.toContain('<u>');
  });

  it('only ever offers one heading level, so a page outline cannot be broken', async () => {
    render(<Harness />);
    await screen.findByRole('toolbar', { name: 'Text formatting' });
    expect(screen.queryByRole('button', { name: /heading 2|heading 4|^H2$|^H4$/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sub-heading' })).toBeInTheDocument();
  });

  it('gives the link popover a labelled field and says where links open', async () => {
    render(<Harness initial="<p>text</p>" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add or edit link' }));
    expect(await screen.findByLabelText('Link address')).toBeInTheDocument();
    expect(screen.getByText(/open in a new tab/i)).toBeInTheDocument();
  });

  it('applies a link with the attributes the render allowlist expects', async () => {
    // Link now comes from TipTap 3's StarterKit rather than its own package.
    render(<Harness initial="<p>passes</p>" />);
    const box = await screen.findByRole('textbox', { name: 'Description' });
    box.focus();
    fireEvent.keyDown(box, { key: 'a', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add or edit link' }));
    const field = await screen.findByLabelText('Link address');
    fireEvent.change(field, { target: { value: 'kenworthy.org/film-passes' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      const a = new DOMParser()
        .parseFromString(screen.getByTestId('stored').textContent ?? '', 'text/html')
        .querySelector('a');
      expect(a?.getAttribute('href')).toBe('https://kenworthy.org/film-passes');
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  it('shows the placeholder only while the field is empty', async () => {
    const noop = vi.fn();
    const { rerender } = render(
      <RichTextEditor value="" onChange={noop} placeholder="Say something" aria-label="D" />,
    );
    expect(await screen.findByText('Say something')).toBeInTheDocument();
    rerender(
      <RichTextEditor
        value="<p>Said.</p>"
        onChange={noop}
        placeholder="Say something"
        aria-label="D"
      />,
    );
    await waitFor(() => expect(screen.queryByText('Say something')).toBeNull());
  });
});
