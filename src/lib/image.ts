/**
 * Shrinks a camera photo before it is sent for reading.
 *
 * A phone camera shot is several megabytes, which is slow to upload on shop
 * wifi and larger than the API accepts; Claude also scales anything longer than
 * 1568px on its long edge down to that size, so sending more pixels than this
 * buys nothing.
 */
export async function downscalePhoto(
  file: File,
  maxEdge = 1568,
  quality = 0.85
): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const source = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process the photo. Upload the sheet as a CSV instead.');
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();

  const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
  if (!base64) throw new Error('The photo could not be prepared for upload.');
  return { base64, mediaType: 'image/jpeg' };
}

/** `imageOrientation` keeps a photo taken in portrait the right way up. */
async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as a photo.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
