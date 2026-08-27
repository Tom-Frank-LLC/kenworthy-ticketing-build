import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';

/**
 * Guards the genre field on the three production forms. What is easy to break
 * here and invisible to TypeScript:
 *
 *  - Enter has to commit a genre without submitting the surrounding form. Get
 *    that wrong and the production saves one chip short, with no error.
 *  - Blur has to commit too. An admin who types a genre and clicks Save rather
 *    than pressing Enter would otherwise lose it silently.
 *  - A typed or pasted comma is a separator, not a character — the stored
 *    string is comma-separated, so a genre containing one cannot survive a
 *    round trip through `parseGenres` anyway.
 *  - Nothing may be added twice, in any casing, or the badges duplicate.
 */

// The suggestion query is a convenience on top of a plain text field; these
// rows stand in for the genres already used elsewhere in the schedule.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        not: () => ({
          limit: () => Promise.resolve({ data: [{ genre: 'Neo-Noir' }], error: null }),
        }),
      }),
    }),
  },
}));

import { GenreInput } from './GenreInput';

function Harness({ initial = [] as string[] }) {
  const [genres, setGenres] = useState<string[]>(initial);
  return (
    <form onSubmit={e => e.preventDefault()} data-testid="form">
      <GenreInput id="genre" kind="film" value={genres} onChange={setGenres} />
      <output data-testid="stored">{genres.join('|')}</output>
    </form>
  );
}

function setup(initial: string[] = []) {
  const onSubmit = vi.fn(e => e.preventDefault());
  const view = render(<Harness initial={initial} />);
  view.getByTestId('form').addEventListener('submit', onSubmit);
  return { onSubmit, box: screen.getByRole('textbox'), stored: () => screen.getByTestId('stored').textContent };
}

describe('GenreInput', () => {
  it('commits on Enter without submitting the form', () => {
    const { box, onSubmit, stored } = setup();
    fireEvent.change(box, { target: { value: 'Drama' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(stored()).toBe('Drama');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('commits on blur, so a half-typed genre is not lost to a Save click', () => {
    const { box, stored } = setup();
    fireEvent.change(box, { target: { value: 'Thriller' } });
    fireEvent.blur(box);
    expect(stored()).toBe('Thriller');
  });

  it('splits a pasted comma-separated list into separate genres', () => {
    const { box, stored } = setup();
    fireEvent.change(box, { target: { value: 'Drama, Comedy' } });
    expect(stored()).toBe('Drama|Comedy');
  });

  it('keeps several genres and renders one chip each', () => {
    const { box } = setup();
    fireEvent.change(box, { target: { value: 'Drama' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'Comedy' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByLabelText('Remove Drama')).toBeTruthy();
    expect(screen.getByLabelText('Remove Comedy')).toBeTruthy();
  });

  it('refuses a duplicate however it is cased', () => {
    const { box, stored } = setup(['Drama']);
    fireEvent.change(box, { target: { value: 'drama' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(stored()).toBe('Drama');
  });

  it('ignores an empty commit', () => {
    const { box, stored } = setup(['Drama']);
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(stored()).toBe('Drama');
  });

  it('removes a genre by its button', () => {
    const { stored } = setup(['Drama', 'Comedy']);
    fireEvent.click(screen.getByLabelText('Remove Drama'));
    expect(stored()).toBe('Comedy');
  });

  it('removes the last genre on Backspace in an empty box', () => {
    const { box, stored } = setup(['Drama', 'Comedy']);
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(stored()).toBe('Drama');
  });

  it('does not eat a Backspace that is deleting typed text', () => {
    const { box, stored } = setup(['Drama']);
    fireEvent.change(box, { target: { value: 'Com' } });
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(stored()).toBe('Drama');
  });

  it('offers a genre already used elsewhere in the schedule', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Neo-Noir' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '+ Neo-Noir' }));
    expect(screen.getByLabelText('Remove Neo-Noir')).toBeTruthy();
  });

  it('stops suggesting a genre once it is on the production', async () => {
    setup(['Drama']);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Neo-Noir' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '+ Drama' })).toBeNull();
  });

  it('filters suggestions by what has been typed', async () => {
    // The strip shows the first dozen; typing has to reach past that cap, or a
    // genre late in the alphabet could never be suggested at all.
    const { box } = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Comedy' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '+ Western' })).toBeNull();
    fireEvent.change(box, { target: { value: 'wes' } });
    expect(screen.getByRole('button', { name: '+ Western' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Comedy' })).toBeNull();
  });
});
