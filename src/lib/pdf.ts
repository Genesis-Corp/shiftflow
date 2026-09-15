/**
 * Reads a PDF into the base64 string the vision API accepts.
 *
 * Unlike a photo (image.ts), there is nothing to downscale — a PDF page is
 * already text-sharp regardless of size, and Claude reads it directly. The
 * only client-side job is turning the file into base64 and catching an
 * oversized upload before it reaches the network, rather than after a slow
 * upload fails on the server.
 *
 * ~21MB raw is the practical ceiling: base64 inflates it to what fits inside
 * the Messages API's 32MB request limit alongside the rest of the request body
 * (see MAX_PDF_BASE64_LENGTH in vision.ts, which enforces the same limit
 * server-side — this is the fast, no-upload-needed check).
 */
const MAX_PDF_BYTES = 21_000_000;

export async function readPdfAsBase64(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `That PDF is ${(file.size / 1_000_000).toFixed(1)}MB, which is too large to read. ` +
      'Export a shorter one, or upload a CSV instead.'
    );
  }

  const buffer = await file.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

/**
 * Chunked conversion — spreading a multi-megabyte Uint8Array into
 * String.fromCharCode(...bytes) in one call blows the JS engine's argument
 * limit long before a real roster PDF's size would otherwise be a problem.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
