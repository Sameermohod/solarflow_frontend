/**
 * Reads an image file and returns a small data URL for storing inside a document profile.
 * Photos become JPEG (white background); logos keep transparency as PNG. The longest side is limited to `maxDim`.
 */
export function fileToDataUrl(file: File, o: { maxDim: number; logo?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return reject(new Error('Choose a PNG, JPEG or WebP image.'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('That image is over 8 MB. Choose a smaller one.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, o.maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('Image processing is not available in this browser.'));
      const png = !!o.logo;
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      const out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82);
      if (out.length > 590_000) return reject(new Error('That image is still too large after resizing. Use a simpler or smaller picture.'));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
