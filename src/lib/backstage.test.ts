import { describe, it, expect } from 'vitest';
import {
  orderBackstagePhotos,
  backstageAltText,
  backstageParagraphs,
  type BackstagePhoto,
} from '@/lib/backstage';

const photo = (over: Partial<BackstagePhoto> & { id: string }): BackstagePhoto => ({
  caption: null,
  file_path: `${over.id}.jpg`,
  display_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('orderBackstagePhotos', () => {
  it('puts a lower display_order first', () => {
    const ordered = orderBackstagePhotos([
      photo({ id: 'b', display_order: 2 }),
      photo({ id: 'a', display_order: 1 }),
    ]);
    expect(ordered.map(p => p.id)).toEqual(['a', 'b']);
  });

  // The case that actually runs: display_order defaults to 0, so an unordered
  // gallery is the common one and the tiebreak is the real rule.
  it('falls back to newest first when nothing has been ordered by hand', () => {
    const ordered = orderBackstagePhotos([
      photo({ id: 'old', created_at: '2025-06-01T00:00:00Z' }),
      photo({ id: 'new', created_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(ordered.map(p => p.id)).toEqual(['new', 'old']);
  });

  it('is total, so two photos uploaded together keep a stable order', () => {
    const same = { display_order: 0, created_at: '2026-06-01T00:00:00Z' };
    const first = orderBackstagePhotos([photo({ id: 'z', ...same }), photo({ id: 'a', ...same })]);
    const second = orderBackstagePhotos([photo({ id: 'a', ...same }), photo({ id: 'z', ...same })]);
    expect(first.map(p => p.id)).toEqual(second.map(p => p.id));
  });

  it('does not mutate its argument', () => {
    const input = [photo({ id: 'b', display_order: 2 }), photo({ id: 'a', display_order: 1 })];
    orderBackstagePhotos(input);
    expect(input.map(p => p.id)).toEqual(['b', 'a']);
  });
});

describe('backstageAltText', () => {
  it('uses the caption', () => {
    expect(backstageAltText({ caption: 'A trio playing to a full room' }))
      .toBe('A trio playing to a full room');
  });

  // alt="" would claim the photograph is decorative. It is the content.
  it.each([null, '', '   '])('describes the room when the caption is %p', (caption) => {
    expect(backstageAltText({ caption })).toBe(
      'An event in the Backstage speakeasy at the Kenworthy',
    );
  });
});

describe('backstageParagraphs', () => {
  it('splits on blank lines', () => {
    expect(backstageParagraphs('One.\n\nTwo.\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps a soft line break inside its paragraph', () => {
    expect(backstageParagraphs('One,\nstill one.')).toEqual(['One,\nstill one.']);
  });

  it.each([null, undefined, '', '\n\n  \n'])('renders nothing for %p', (body) => {
    expect(backstageParagraphs(body)).toEqual([]);
  });
});
