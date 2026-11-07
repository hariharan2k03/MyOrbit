/**
 * UTF-8 → string without TextDecoder, which Hermes doesn't guarantee.
 * Follows the WHATWG decoder: each maximal invalid subpart becomes one U+FFFD,
 * so output matches TextDecoder's default (non-fatal) mode.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    // Sequence length and the allowed range of the second byte (excludes overlongs and surrogates).
    let len = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) len = 2;
    else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    }
    if (len === 0) {
      out += '�';
      i++;
      continue;
    }
    let cp = b & (0xff >> (len + 1));
    let k = 1;
    for (; k < len; k++) {
      const c = bytes[i + k];
      const min = k === 1 ? lo : 0x80;
      const max = k === 1 ? hi : 0xbf;
      if (c === undefined || c < min || c > max) break;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (k === len) out += String.fromCodePoint(cp);
    else out += '�';
    i += k;
  }
  return out;
}
