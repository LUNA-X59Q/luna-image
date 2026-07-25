// PNG 텍스트 청크(tEXt / zTXt / iTXt) 파서.
// PIL 의 Image.info 와 동일한 「키 → 문자열」 형태를 돌려준다.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes) {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

// 규격상 tEXt 는 latin-1 이지만 실제로는 UTF-8 로 쓰는 도구가 많다.
// UTF-8 로 먼저 시도하고 깨지면 latin-1 로 되돌린다.
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function indexOfZero(bytes, from, to) {
  for (let i = from; i < to; i++) if (bytes[i] === 0) return i;
  return -1;
}

/**
 * PNG 바이트에서 텍스트 청크를 모두 읽어 평범한 객체로 돌려준다.
 * @returns {Promise<Record<string, string>>}
 */
export async function readPngTextChunks(bytes) {
  const info = {};
  if (!isPng(bytes)) return info;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;

    try {
      if (type === 'tEXt') {
        const sep = indexOfZero(bytes, start, end);
        if (sep !== -1) {
          info[decodeText(bytes.subarray(start, sep))] = decodeText(bytes.subarray(sep + 1, end));
        }
      } else if (type === 'zTXt') {
        const sep = indexOfZero(bytes, start, end);
        if (sep !== -1) {
          const raw = await inflate(bytes.subarray(sep + 2, end));
          info[decodeText(bytes.subarray(start, sep))] = decodeText(raw);
        }
      } else if (type === 'iTXt') {
        const sep = indexOfZero(bytes, start, end);
        if (sep !== -1) {
          const keyword = decodeText(bytes.subarray(start, sep));
          const compressed = bytes[sep + 1] === 1;
          const langEnd = indexOfZero(bytes, sep + 3, end);
          const transEnd = langEnd === -1 ? -1 : indexOfZero(bytes, langEnd + 1, end);
          if (transEnd !== -1) {
            const payload = bytes.subarray(transEnd + 1, end);
            info[keyword] = utf8.decode(compressed ? await inflate(payload) : payload);
          }
        }
      } else if (type === 'IEND') {
        break;
      }
    } catch (err) {
      console.warn(`${type} 청크를 읽지 못했습니다:`, err);
    }

    offset = end + 4; // 데이터 뒤의 CRC 4바이트를 건너뛴다
  }

  return info;
}
