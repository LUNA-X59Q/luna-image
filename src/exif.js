// JPEG / WebP 에서 EXIF · XMP · COM 을 뽑아 PNG 텍스트 청크와 같은 모양의 객체로 만든다.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

const TIFF_TAGS = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x9286: 'UserComment',
  0x9c9b: 'XPTitle',
  0x9c9c: 'XPComment',
  0x9c9d: 'XPAuthor',
  0x9c9e: 'XPKeywords',
  0x9c9f: 'XPSubject',
};

const EXIF_IFD_POINTER = 0x8769;
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function trimNull(text) {
  return text.replace(/\0+$/, '');
}

/** UserComment 는 앞 8바이트가 문자 코드 지정자다. */
function decodeUserComment(bytes) {
  if (bytes.length <= 8) return '';
  const code = trimNull(latin1.decode(bytes.subarray(0, 8))).trim();
  const body = bytes.subarray(8);
  if (code === 'UNICODE') {
    // 바이트 순서 표시가 없으므로 널 바이트 위치로 UTF-16 엔디언을 추정한다.
    const littleEndian = body.length > 1 && body[1] === 0;
    let out = '';
    for (let i = 0; i + 1 < body.length; i += 2) {
      const unit = littleEndian ? body[i] | (body[i + 1] << 8) : (body[i] << 8) | body[i + 1];
      if (unit === 0) break;
      out += String.fromCharCode(unit);
    }
    return out;
  }
  return trimNull(decodeMaybeUtf8(body));
}

function decodeMaybeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

function decodeUtf16le(bytes) {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const unit = bytes[i] | (bytes[i + 1] << 8);
    if (unit === 0) break;
    out += String.fromCharCode(unit);
  }
  return out;
}

/** TIFF 헤더로 시작하는 바이트에서 문자열 태그를 읽는다. */
function parseTiff(bytes) {
  const out = {};
  if (bytes.length < 8) return out;

  const byteOrder = latin1.decode(bytes.subarray(0, 2));
  if (byteOrder !== 'II' && byteOrder !== 'MM') return out;
  const little = byteOrder === 'II';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readIfd = (offset, depth) => {
    if (depth > 2 || offset <= 0 || offset + 2 > bytes.length) return;
    const count = view.getUint16(offset, little);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > bytes.length) return;

      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const valueCount = view.getUint32(entry + 4, little);
      const byteLength = (TYPE_SIZES[type] || 0) * valueCount;
      if (!byteLength) continue;

      const valueOffset = byteLength <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
      if (valueOffset + byteLength > bytes.length) continue;
      const value = bytes.subarray(valueOffset, valueOffset + byteLength);

      if (tag === EXIF_IFD_POINTER && type === 4) {
        readIfd(view.getUint32(valueOffset, little), depth + 1);
        continue;
      }

      const name = TIFF_TAGS[tag];
      if (!name) continue;

      let text;
      if (name === 'UserComment') text = decodeUserComment(value);
      else if (name.startsWith('XP')) text = decodeUtf16le(value);
      else text = trimNull(decodeMaybeUtf8(value));

      if (text) out[name] = text;
    }
  };

  readIfd(view.getUint32(4, little), 0);
  return out;
}

/** "Exif\0\0" 접두사가 있으면 떼어내고 TIFF 를 읽는다. */
function parseExifBlob(bytes) {
  if (latin1.decode(bytes.subarray(0, 4)) === 'Exif') return parseTiff(bytes.subarray(6));
  return parseTiff(bytes);
}

export function isJpeg(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

export function isWebp(bytes) {
  return (
    latin1.decode(bytes.subarray(0, 4)) === 'RIFF' &&
    latin1.decode(bytes.subarray(8, 12)) === 'WEBP'
  );
}

export function readJpegMetadata(bytes) {
  const out = {};
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / 이미지 데이터 시작

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > bytes.length) break;
    const segment = bytes.subarray(start, end);

    if (marker === 0xe1) {
      const head = latin1.decode(segment.subarray(0, 29));
      if (head.startsWith('Exif\0\0')) Object.assign(out, parseExifBlob(segment));
      else if (head.startsWith('http://ns.adobe.com/xap/1.0/\0')) {
        out.XMP = utf8.decode(segment.subarray(29));
      }
    } else if (marker === 0xfe) {
      out.Comment = trimNull(decodeMaybeUtf8(segment));
    }

    offset = end;
  }

  return out;
}

export function readWebpMetadata(bytes) {
  const out = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const fourcc = latin1.decode(bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.length) break;
    const chunk = bytes.subarray(start, start + size);

    if (fourcc === 'EXIF') Object.assign(out, parseExifBlob(chunk));
    else if (fourcc === 'XMP ') out.XMP = utf8.decode(chunk);

    offset = start + size + (size % 2); // 청크는 짝수 바이트로 정렬된다
  }

  return out;
}
