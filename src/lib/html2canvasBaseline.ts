// Tailwind's preflight sets `img { display: block }`. html2canvas finds the
// text baseline by measuring an inline <img> it places beside a text run, in the
// live document, so under preflight it puts every line of text several pixels too
// low: borders and rules then run through the glyphs and read as strikethrough.
// Restore inline images for the length of the export only.
export async function withHtml2CanvasBaseline<T>(render: () => Promise<T>): Promise<T> {
  const style = document.createElement('style');
  style.textContent = 'img { display: inline-block; }';
  document.head.appendChild(style);
  try {
    return await render();
  } finally {
    style.remove();
  }
}
