// Stealth PNG Info 디코더.
// 알파 채널(또는 RGB) 최하위 비트에 숨겨진 생성 정보를 읽어낸다.
// 알고리즘 원본: https://github.com/neggles/sd-webui-stealth-pnginfo/

const SIGNATURE_BITS = 'stealth_pnginfo'.length * 8; // 120

const ALPHA_SIGNATURES = { stealth_pnginfo: false, stealth_pngcomp: true };
const RGB_SIGNATURES = { stealth_rgbinfo: false, stealth_rgbcomp: true };

function bitsToBytes(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    const chunk = Math.min(8, bits.length - i * 8);
    for (let b = 0; b < chunk; b++) byte = (byte << 1) | bits[i * 8 + b];
    out[i] = byte;
  }
  return out;
}

function bitsToInt(bits) {
  return bits.reduce((acc, bit) => acc * 2 + bit, 0);
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ImageData 에서 숨겨진 문자열을 읽는다. 없으면 null.
 * @param {ImageData} imageData
 * @returns {Promise<string|null>}
 */
export async function readStealthInfo(imageData) {
  const { width, height, data } = imageData;

  let mode = null;
  let compressed = false;
  let paramLen = 0;
  let binaryData = null;

  let bufferA = [];
  let bufferRGB = [];
  let indexA = 0;
  let indexRGB = 0;

  let sigConfirmed = false;
  let confirmingSignature = true;
  let readingParamLen = false;
  let readingParam = false;
  let readEnd = false;

  // 원본과 동일하게 열 우선(column-major)으로 순회한다.
  for (let x = 0; x < width && !readEnd; x++) {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;

      if (mode !== 'rgb') {
        bufferA.push(data[i + 3] & 1);
        indexA += 1;
      }
      if (mode !== 'alpha') {
        bufferRGB.push(data[i] & 1, data[i + 1] & 1, data[i + 2] & 1);
        indexRGB += 3;
      }

      if (confirmingSignature) {
        // RGB 시그니처가 40픽셀, 알파 시그니처가 120픽셀 지점에서 확인된다.
        if (indexA === SIGNATURE_BITS) {
          const sig = decodeSignature(bufferA);
          if (sig in ALPHA_SIGNATURES) {
            confirmingSignature = false;
            sigConfirmed = true;
            readingParamLen = true;
            mode = 'alpha';
            compressed = ALPHA_SIGNATURES[sig];
            bufferA = [];
            indexA = 0;
          } else {
            readEnd = true;
            break;
          }
        } else if (indexRGB === SIGNATURE_BITS) {
          const sig = decodeSignature(bufferRGB);
          if (sig in RGB_SIGNATURES) {
            confirmingSignature = false;
            sigConfirmed = true;
            readingParamLen = true;
            mode = 'rgb';
            compressed = RGB_SIGNATURES[sig];
            bufferRGB = [];
            indexRGB = 0;
          }
        }
      } else if (readingParamLen) {
        if (mode === 'alpha') {
          if (indexA === 32) {
            paramLen = bitsToInt(bufferA);
            readingParamLen = false;
            readingParam = true;
            bufferA = [];
            indexA = 0;
          }
        } else if (indexRGB === 33) {
          // RGB 는 3비트씩 늘어나 32를 1비트 넘어선다. 넘친 비트는 되돌려 놓는다.
          const overflow = bufferRGB.pop();
          paramLen = bitsToInt(bufferRGB);
          readingParamLen = false;
          readingParam = true;
          bufferRGB = [overflow];
          indexRGB = 1;
        }
      } else if (readingParam) {
        if (mode === 'alpha') {
          if (indexA === paramLen) {
            binaryData = bufferA;
            readEnd = true;
            break;
          }
        } else if (indexRGB >= paramLen) {
          binaryData = indexRGB > paramLen ? bufferRGB.slice(0, paramLen) : bufferRGB;
          readEnd = true;
          break;
        }
      } else {
        readEnd = true;
        break;
      }
    }
  }

  if (!sigConfirmed || !binaryData || binaryData.length === 0) return null;

  try {
    const bytes = bitsToBytes(binaryData);
    const raw = compressed ? await gunzip(bytes) : bytes;
    return new TextDecoder('utf-8').decode(raw);
  } catch (err) {
    console.warn('Stealth PNG Info 를 해석하지 못했습니다:', err);
    return null;
  }
}

function decodeSignature(bits) {
  return new TextDecoder('utf-8').decode(bitsToBytes(bits));
}

/**
 * 파일을 캔버스에 그려 원본 픽셀값을 얻는다.
 * 색 관리와 알파 프리멀티플라이를 끄지 않으면 최하위 비트가 손상된다.
 * @param {Blob} blob
 * @returns {Promise<ImageData>}
 */
export async function getImageData(blob) {
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
  } finally {
    bitmap.close();
  }
}
