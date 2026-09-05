import { describe, expect, it } from 'vitest';
import { resolveTrailer } from './trailer';

describe('resolveTrailer', () => {
  it('recognises the URL forms an admin actually pastes', () => {
    const cases: Array<[string, string]> = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
      ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube'],
      ['https://vimeo.com/123456789', 'vimeo'],
      ['https://vimeo.com/video/123456789', 'vimeo'],
      ['https://cdn.example.com/trailer.mp4', 'file'],
      ['https://cdn.example.com/trailer.mov', 'file'],
      ['https://cdn.example.com/trailer.m4v?v=2', 'file'],
    ];
    for (const [url, kind] of cases) {
      expect(resolveTrailer(url), url).toMatchObject({ kind });
    }
  });

  it('returns null for empty and unrecognised input', () => {
    expect(resolveTrailer(null)).toBeNull();
    expect(resolveTrailer('')).toBeNull();
    expect(resolveTrailer('   ')).toBeNull();
    expect(resolveTrailer('https://example.com/not-a-video')).toBeNull();
  });

  it('defaults to the ambient marquee player: no controls, looping', () => {
    const yt = resolveTrailer('https://youtu.be/dQw4w9WgXcQ')!;
    expect(yt.src).toContain('controls=0');
    expect(yt.src).toContain('loop=1');
    // YouTube only honours loop when the video is also its own playlist.
    expect(yt.src).toContain('playlist=dQw4w9WgXcQ');

    const vimeo = resolveTrailer('https://vimeo.com/123456789')!;
    expect(vimeo.src).toContain('background=1');
  });

  it('gives the drawer and ticketing page a real player when asked', () => {
    const yt = resolveTrailer('https://youtu.be/dQw4w9WgXcQ', { controls: true, loop: false })!;
    expect(yt.src).toContain('controls=1');
    expect(yt.src).toContain('loop=0');
    expect(yt.src).not.toContain('playlist=');

    const vimeo = resolveTrailer('https://vimeo.com/123456789', { controls: true, loop: false })!;
    expect(vimeo.src).toContain('controls=1');
    expect(vimeo.src).toContain('background=0');
  });

  /**
   * Every trailer on this site is a YouTube or Vimeo embed — 788 of them in
   * production, and not one self-hosted file. We cannot caption a
   * distributor's video, so asking the player to switch on whatever track it
   * already has is the entire lever we hold on WCAG 1.2.2.
   *
   * Tied to `controls`, which is the flag that distinguishes the real player
   * from the muted ambient marquee. A silent background clip has no audio to
   * caption.
   */
  it('asks for captions on the real player, and not on the silent marquee', () => {
    const yt = resolveTrailer('https://youtu.be/dQw4w9WgXcQ', { controls: true })!;
    expect(yt.src).toContain('cc_load_policy=1');

    const vimeo = resolveTrailer('https://vimeo.com/123456789', { controls: true })!;
    expect(vimeo.src).toContain('texttrack=en');

    expect(resolveTrailer('https://youtu.be/dQw4w9WgXcQ')!.src).not.toContain('cc_load_policy');
    expect(resolveTrailer('https://vimeo.com/123456789')!.src).not.toContain('texttrack');
  });
});
