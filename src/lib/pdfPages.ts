/**
 * A PDF's pages as images, rendered in the browser.
 *
 * The festival page shows a programme as a slideshow of page images, not as
 * an embedded PDF, and until now only scripts/import-festival-programs.mjs
 * could produce those images (with pdftoppm, offline). An admin who uploaded
 * a booklet from Pages → Festival Programs got a download link and a "not
 * scanned page by page yet" pane, which is the whole reason this file exists.
 *
 * Rendering happens here, in the admin's browser, rather than server-side:
 * edge functions run Deno and cannot shell out to poppler, the work is
 * admin-only, and a programme is eight to thirty pages. pdf.js is loaded on
 * demand from inside the upload, so the admin bundle does not carry it.
 *
 * The output is meant to be indistinguishable from the script's: the same
 * page width, JPEG at the same quality, one image per page in page order.
 * PAGE_WIDTH and PAGE_QUALITY are the script's constants, copied rather than
 * imported because the script is Node-only and this runs in a browser.
 */

/** Stored page width. A 5.5in booklet page at this width is ~360dpi. */
export const PAGE_WIDTH = 2000;
/** High enough that small caption type stays crisp; JPEG because these are scans. */
export const PAGE_QUALITY = 0.88;

/** A programme is a booklet, not a book. Above this something else was picked. */
const MAX_PAGES = 200;

export interface RenderedPage {
  /** 1-based, in reading order. */
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface RenderOptions {
  width?: number;
  quality?: number;
  /** Called after each page, with the count so far and the total. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Every page of `file`, page 1 first.
 *
 * Throws on anything that would leave a year half-rendered: a file pdf.js
 * cannot open, a page that fails to draw, a canvas that will not encode.
 * The caller treats any throw as "store the PDF as a download only", which is
 * exactly what the upload did before this existed — a failure here costs the
 * flip-through, never the upload.
 */
export async function renderPdfPages(file: Blob, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  const width = opts.width ?? PAGE_WIDTH;
  const quality = opts.quality ?? PAGE_QUALITY;

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const total = doc.numPages;
    if (total > MAX_PAGES) {
      throw new Error(`That PDF has ${total} pages — more than a programme should.`);
    }

    // One canvas, reused: page images at this width are ~2000×3000, and a
    // fresh canvas per page is thirty of those waiting on the collector.
    const canvas = document.createElement('canvas');
    const pages: RenderedPage[] = [];

    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      try {
        // Scale so the page comes out `width` pixels across, whatever its
        // nominal size — the script's `-r 360` lands there for a 5.5in page,
        // but a booklet scanned at letter size would come out oversized.
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('The browser would not give us a drawing surface.');
        // Scans have no transparency, but a page can. The script's JPEG output
        // is white where a PDF is blank, and so is this.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // `print`, not the default `display`. A display render paces its
        // work with requestAnimationFrame, and a browser stops delivering
        // frames to a tab that is not visible — so an admin who switched tabs
        // while thirty pages rendered would come back to an upload stalled on
        // page two (observed: ~25s per page in a hidden tab, ~10ms with this).
        // A print render draws the same pixels without waiting for a frame.
        await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
        const blob = await toBlob(canvas, 'image/jpeg', quality);
        pages.push({ page: n, blob, width: canvas.width, height: canvas.height });
      } finally {
        page.cleanup();
      }
      opts.onProgress?.(n, total);
    }

    return pages;
  } finally {
    // The task owns the worker's copy of the document; the proxy has no
    // destroy of its own.
    await task.destroy();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be encoded as an image.'))),
      type,
      quality,
    );
  });
}

/**
 * pdf.js, loaded once and only when a PDF is actually being uploaded.
 *
 * The worker is pdf.js's own build, served as an asset by Vite — `?url` gives
 * the hashed path, and pointing GlobalWorkerOptions at it is what keeps the
 * parse off the main thread. Without a worker pdf.js falls back to running in
 * the page, which works and freezes the admin for the duration.
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, { default: workerSrc }] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}
