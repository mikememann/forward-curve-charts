import { inflateRawSync } from "node:zlib";

/** Stored or deflate entries from a zip buffer. Enough for the BoE yield-curve archives. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 < buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith("/")) {
      if (method === 0) out.set(name, Buffer.from(data));
      else if (method === 8) out.set(name, inflateRawSync(data));
    }
    offset = dataStart + compSize;
  }
  return out;
}
