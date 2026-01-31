import { Readable } from 'node:stream';

export function readableFromBuffer(buffer: Buffer): Readable {
  return Readable.from([buffer]);
}

