/**
 * Shared stream utilities — avoids duplicating helpers across workers.
 */

import type { Readable } from 'stream';

/** Collect a readable stream into a single Buffer. */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
