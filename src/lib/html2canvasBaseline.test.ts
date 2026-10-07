import { describe, expect, it } from 'vitest';
import { withHtml2CanvasBaseline } from './html2canvasBaseline';

const injected = () =>
  [...document.head.querySelectorAll('style')].filter((s) => s.textContent?.includes('img { display: inline-block; }'));

describe('withHtml2CanvasBaseline', () => {
  it('restores inline images only while the export runs', async () => {
    const during = await withHtml2CanvasBaseline(async () => injected().length);
    expect(during).toBe(1);
    expect(injected()).toHaveLength(0);
  });

  it('removes the style when the export fails', async () => {
    await expect(withHtml2CanvasBaseline(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(injected()).toHaveLength(0);
  });
});
