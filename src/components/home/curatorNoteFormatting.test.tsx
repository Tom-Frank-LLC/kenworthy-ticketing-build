import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShowingPreview } from './ShowingPreview';
import { BoothNote } from './BoothNote';
import { EditorialCalendar } from './EditorialCalendar';
import type { FeedItem } from './TrailerFeed';

/**
 * The three surfaces that show a curator's note beside a listing.
 *
 * All three used to call `htmlToPlainText()` on it, so a note written in the
 * admin editor read as formatted copy on the ticket page and as one flat run
 * of text everywhere else — which is what Tom reported. The flattening was
 * deliberate but rested on a measurement nobody had taken (see the correction
 * in FINDINGS-richtext-description-surface.md), and these pin the repair.
 *
 * The failure being guarded is specifically *not* "the words are missing" —
 * the words were always there. It is that the markup around them was thrown
 * away, which no assertion on text content can see. So each test asserts on
 * elements, and on the two things that made flattening look necessary: the
 * clamp still bounding the calendar row, and no `<a>` left inside a
 * `<button>`.
 */

const RICH_NOTE =
  '<p>A <strong>restored</strong> 35mm print.</p><p>Introduced by the archivist.</p><ul><li>Silent, with live organ</li></ul>';

/** What every row written before the editor shipped still looks like. */
const LEGACY_NOTE = 'A restored 35mm print.\n\nIntroduced by the archivist.';

const base: Omit<FeedItem, 'id' | 'showingId' | 'startTime'> = {
  productionId: 'prod-1',
  title: 'The Gold Rush',
  posterUrl: null,
  trailerUrl: null,
  type: 'movie',
};

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    ...base,
    id: 'movie-prod-1-showing-a',
    showingId: 'showing-a',
    startTime: '2099-01-01T19:00:00Z',
    ...overrides,
  };
}

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('a curator note renders as formatted copy, not flattened text', () => {
  it('renders editor markup as elements in the preview pane', () => {
    const { container } = wrap(<ShowingPreview item={item({ curatorNote: RICH_NOTE })} />);
    const note = screen.getByRole('region', { name: /About The Gold Rush/i });

    // Elements, not a string: `getByText` would pass on the flattened version
    // too, since flattening kept every word.
    expect(within(note).getByText('restored').tagName).toBe('STRONG');
    expect(note.querySelectorAll('p')).toHaveLength(2);
    expect(within(note).getByRole('listitem').textContent).toContain('live organ');

    // The tags are rendered, not printed. A `dangerouslySetInnerHTML` that was
    // accidentally escaped shows its markup as visible text and would still
    // satisfy every assertion above.
    expect(container.textContent).not.toContain('<strong>');
  });

  it('renders editor markup as elements in the curator’s pick', () => {
    wrap(<BoothNote items={[item({ curatorNote: RICH_NOTE, isFeatured: true })]} />);
    const note = screen.getByRole('region', { name: /About The Gold Rush/i });

    expect(within(note).getByText('restored').tagName).toBe('STRONG');
    expect(note.querySelectorAll('p')).toHaveLength(2);
  });

  it('renders editor markup as elements in a calendar row, still clamped', () => {
    const { container } = wrap(<EditorialCalendar items={[item({ curatorNote: RICH_NOTE })]} />);

    const note = container.querySelector('.rich-text');
    expect(note).not.toBeNull();
    expect(note!.querySelector('strong')?.textContent).toBe('restored');

    // The row is two lines tall and stays that way. `rich-text-teaser` zeroes
    // the child margins that would otherwise defeat the clamp — drop either
    // class and the row grows to the full note.
    expect(note!.classList.contains('line-clamp-2')).toBe(true);
    expect(note!.classList.contains('rich-text-teaser')).toBe(true);
  });

  it('still renders a legacy plain-text note, as paragraphs', () => {
    // No migration ran: most rows are still plain text with blank lines, and
    // `toRichHtml` normalises them at read time. A row nobody has edited has
    // to keep working.
    wrap(<ShowingPreview item={item({ curatorNote: LEGACY_NOTE })} />);
    const note = screen.getByRole('region', { name: /About The Gold Rush/i });

    expect(note.querySelectorAll('p')).toHaveLength(2);
    expect(note.textContent).toContain('Introduced by the archivist.');
  });

  it('renders nothing for a note the author emptied', () => {
    // TipTap stores a cleared editor as `<p></p>`, which is truthy. Guarding
    // on the string rather than the text draws an empty scroll region.
    wrap(<ShowingPreview item={item({ curatorNote: '<p></p>' })} />);
    expect(screen.queryByRole('region', { name: /About The Gold Rush/i })).toBeNull();
  });
});

describe('the calendar row stays a control, and a legal one', () => {
  it('keeps no anchor inside a button when a note carries a link', () => {
    // The reason this row was restructured. An `<a>` inside a `<button>` is
    // invalid HTML and browsers recover from it unpredictably; the note is a
    // description column an external host can write to, so it can hold a link.
    const { container } = wrap(
      <EditorialCalendar
        items={[item({ curatorNote: '<p>See the <a href="https://example.com">programme</a>.</p>' })]}
      />,
    );

    expect(container.querySelector('a')).not.toBeNull();
    expect(container.querySelector('button a')).toBeNull();
  });

  it('still selects the showing when the row is clicked', () => {
    const picked: FeedItem[] = [];
    wrap(
      <EditorialCalendar
        items={[item({ curatorNote: RICH_NOTE })]}
        onSelect={(i) => picked.push(i)}
      />,
    );

    // The overlay button is named for the title alone. As a wrapper its
    // accessible name was the whole row read out as one string.
    screen.getByRole('button', { name: 'Details for The Gold Rush' }).click();
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe('movie-prod-1-showing-a');
  });

  it('marks the chosen row with aria-current', () => {
    wrap(
      <EditorialCalendar
        items={[item({ curatorNote: RICH_NOTE })]}
        selectedId="movie-prod-1-showing-a"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Details for The Gold Rush' }).getAttribute('aria-current'),
    ).toBe('true');
  });
});
