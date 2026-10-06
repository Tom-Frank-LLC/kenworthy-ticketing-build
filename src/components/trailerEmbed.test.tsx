import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductionMedia } from './ProductionMedia';
import { TrailerModal } from './TrailerModal';

/**
 * The trailer frame no longer falls back to the raw trailer_url (audit
 * 2026-10-06, L13). That fallback rendered on page load, from a column hosts
 * can write, with only the CSP between a `javascript:` URL and the page. An
 * unrecognised value now means "no trailer": the poster shows, and the
 * "Watch trailer" button does not.
 */
const HOSTILE = ['javascript:alert(document.domain)', 'data:text/html,<script>alert(1)</script>', 'https://evil.example/embed'];

describe('ProductionMedia', () => {
  it.each(HOSTILE)('shows the poster, and no frame, for %j', url => {
    const { container } = render(
      <ProductionMedia title="Film" type="movie" trailerUrl={url} posterUrl="https://cdn.example.com/p.jpg" />,
    );
    expect(container.querySelector('iframe, video')).toBeNull();
    expect(screen.getByRole('img', { name: 'Film' })).toBeTruthy();
  });

  it('still embeds a recognised trailer, from the player host', () => {
    const { container } = render(
      <ProductionMedia title="Film" type="movie" trailerUrl="https://youtu.be/dQw4w9WgXcQ" />,
    );
    const src = container.querySelector('iframe')!.getAttribute('src')!;
    expect(new URL(src).origin).toBe('https://www.youtube.com');
  });
});

describe('TrailerModal', () => {
  it.each(HOSTILE)('renders no trigger for %j', url => {
    render(
      <TrailerModal title="Film" trailerUrl={url}>
        <button>Watch trailer</button>
      </TrailerModal>,
    );
    expect(screen.queryByRole('button', { name: 'Watch trailer' })).toBeNull();
  });

  it('opens a recognised trailer in the player host frame', () => {
    render(
      <TrailerModal title="Film" trailerUrl="https://vimeo.com/123456789">
        <button>Watch trailer</button>
      </TrailerModal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Watch trailer' }));
    const frame = screen.getByTitle('Film trailer') as HTMLIFrameElement;
    expect(new URL(frame.src).origin).toBe('https://player.vimeo.com');
  });
});
