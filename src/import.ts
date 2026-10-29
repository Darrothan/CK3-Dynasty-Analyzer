import { unzipSync } from 'fflate';

const MAX_FILE = 512 * 1024 * 1024;
const MAX_EXPANDED = 768 * 1024 * 1024;

export function extractGamestate(input: Uint8Array): Uint8Array {
  if (!input.length) throw new Error('The selected file is empty.');
  if (input.length > MAX_FILE) throw new Error('The file exceeds the 512 MiB import limit.');
  let zip = -1;
  for (let i = 0; i < Math.min(input.length - 3, 1024 * 1024); i++) {
    if (input[i] === 0x50 && input[i + 1] === 0x4b && input[i + 2] === 3 && input[i + 3] === 4) { zip = i; break; }
  }
  let content = input;
  if (zip >= 0) {
    let found = false;
    try {
      const files = unzipSync(input.subarray(zip), { filter: entry => {
        const matches = /(^|\/)gamestate$/i.test(entry.name);
        if (matches) {
          if (found) throw new Error('Archive contains multiple gamestate entries.');
          if (entry.originalSize > MAX_EXPANDED) throw new Error('The expanded gamestate exceeds the 768 MiB limit.');
          found = true;
        }
        return matches;
      } });
      const entries = Object.values(files);
      if (entries.length !== 1) throw new Error('Archive does not contain a gamestate entry.');
      content = entries[0];
    } catch (error) {
      throw new Error(`Could not extract gamestate: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!content.length) throw new Error('The gamestate is empty.');
  const sample = content.subarray(0, Math.min(content.length, 8192));
  if (sample.some(byte => byte === 0 || (byte < 9 || (byte > 13 && byte < 32)))) {
    throw new Error('Binary or unsupported gamestate encoding detected. Export a plaintext save.');
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let offset = 0; offset < content.length; offset += 1024 * 1024) {
      decoder.decode(content.subarray(offset, offset + 1024 * 1024), { stream: true });
    }
    decoder.decode();
  }
  catch { throw new Error('The gamestate is not valid UTF-8 plaintext. Other encodings are not currently supported.'); }
  let depth = 0, quoted = false, escaped = false, comment = false;
  for (const byte of content) {
    if (comment) { if (byte === 10) comment = false; continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) quoted = false;
    } else if (byte === 35) comment = true;
    else if (byte === 34) quoted = true;
    else if (byte === 123) depth++;
    else if (byte === 125 && --depth < 0) throw new Error('Invalid plaintext: unexpected closing brace.');
  }
  if (depth !== 0 || quoted) throw new Error('Invalid plaintext: incomplete block or quoted string.');
  return content;
}
