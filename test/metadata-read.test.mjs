// 파일 바이트 → 메타데이터 사전까지의 읽기 경로를 지킨다.
// PNG 시그니처 · tEXt/zTXt/iTXt · 널 구분 · 압축 해제 · JPEG/WebP EXIF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { isPng, readPngTextChunks } from '../src/png.js';
import { isJpeg, isWebp, readJpegMetadata, readWebpMetadata } from '../src/exif.js';
import { getNaiDict } from '../src/nai-dict.js';

// ── PNG 만들기 ────────────────────────────────────────────

const CRC = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};
const NUL = Buffer.from([0]);

const tEXt = (key, value) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), NUL, Buffer.from(value, 'utf8')]));
const zTXt = (key, value) =>
  chunk('zTXt', Buffer.concat([Buffer.from(key, 'latin1'), NUL, NUL, zlib.deflateSync(Buffer.from(value, 'utf8'))]));
/** iTXt: 키워드\0 압축플래그 압축방식 언어\0 번역키워드\0 본문 */
const iTXt = (key, value, compress) => chunk('iTXt', Buffer.concat([
  Buffer.from(key, 'latin1'), NUL,
  Buffer.from([compress ? 1 : 0, 0]),
  NUL, NUL,
  compress ? zlib.deflateSync(Buffer.from(value, 'utf8')) : Buffer.from(value, 'utf8'),
]));

const png = (...chunks) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), ...chunks,
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
};

// ── PNG 시그니처 ──────────────────────────────────────────

test('PNG 시그니처를 확인한다', () => {
  assert.equal(isPng(png()), true);
  assert.equal(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), false);
  assert.equal(isPng(new Uint8Array([0x89, 0x50])), false);
});

// ── 텍스트 청크 ───────────────────────────────────────────

test('tEXt 를 키와 값으로 가른다', async () => {
  const info = await readPngTextChunks(png(tEXt('Software', 'NovelAI')));
  assert.equal(info.Software, 'NovelAI');
});

test('값 안에 널이 없어도 첫 널만 구분자로 쓴다', async () => {
  const info = await readPngTextChunks(png(tEXt('Comment', '{"prompt":"a: b, c"}')));
  assert.equal(info.Comment, '{"prompt":"a: b, c"}');
});

test('zTXt 를 풀어 읽는다', async () => {
  const info = await readPngTextChunks(png(zTXt('parameters', '1girl\nNegative prompt: lowres')));
  assert.equal(info.parameters, '1girl\nNegative prompt: lowres');
});

test('iTXt 를 압축 · 비압축 모두 읽는다', async () => {
  const plain = await readPngTextChunks(png(iTXt('Comment', '한글 프롬프트, 1girl', false)));
  assert.equal(plain.Comment, '한글 프롬프트, 1girl');

  const packed = await readPngTextChunks(png(iTXt('Comment', '한글 프롬프트, 1girl', true)));
  assert.equal(packed.Comment, '한글 프롬프트, 1girl');
});

test('tEXt 의 UTF-8 값을 깨뜨리지 않는다', async () => {
  const info = await readPngTextChunks(png(tEXt('Description', '여성 1명, 남성 1명')));
  assert.equal(info.Description, '여성 1명, 남성 1명');
});

test('같은 키의 청크가 둘이면 둘 다 남긴다', async () => {
  const info = await readPngTextChunks(png(
    tEXt('Comment', '{"prompt":"먼저 쓰인 것"}'),
    tEXt('Comment', '{"prompt":"나중에 덧붙은 것"}'),
  ));
  assert.equal(info.Comment, '{"prompt":"먼저 쓰인 것"}');
  assert.equal(info['Comment (2)'], '{"prompt":"나중에 덧붙은 것"}');
});

test('생성 정보가 두 벌이면 경고를 낸다', async () => {
  const info = await readPngTextChunks(png(
    tEXt('Comment', JSON.stringify({ prompt: '1girl, 1boy', uc: 'lowres' })),
    tEXt('Comment', JSON.stringify({ prompt: '3girls', uc: 'nsfw' })),
  ));
  const result = getNaiDict([{ label: 'EXIF', info }]);
  assert.equal(result.naiDict.prompt, '1girl, 1boy');
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /두 벌/);
});

test('픽셀에 숨은 정보가 따로 있으면 알린다', () => {
  const result = getNaiDict([
    { label: 'EXIF', info: { Comment: JSON.stringify({ prompt: '1girl, 1boy', uc: 'lowres' }) } },
    { label: 'Stealth PNG Info', info: { parameters: '3girls\nNegative prompt: nsfw\nSteps: 20, Sampler: Euler a, CFG scale: 7' } },
  ]);
  assert.equal(result.source, 'EXIF');
  assert.equal(result.naiDict.prompt, '1girl, 1boy');
  assert.match(result.notes.join(' '), /Stealth PNG Info/);
});

test('제대로 된 NAI 이미지에는 경고가 붙지 않는다', () => {
  const comment = JSON.stringify({
    prompt: '1girl, 1boy, cafe', uc: 'lowres, worst quality', steps: 28, seed: 42,
    v4_prompt: { caption: { base_caption: '1girl, 1boy, cafe', char_captions: [] } },
    v4_negative_prompt: { caption: { base_caption: 'lowres, worst quality', char_captions: [] } },
  });
  const result = getNaiDict([{ label: 'EXIF', info: { Comment: comment, Software: 'NovelAI' } }]);
  assert.deepEqual(result.notes, []);
});

// ── NAI v4 의 두 군데 프롬프트 ────────────────────────────

const naiV4 = (over) => getNaiDict([{ label: 'EXIF', info: { Comment: JSON.stringify({
  prompt: '1girl, 1boy, cafe', uc: 'lowres', seed: 42,
  v4_prompt: { caption: { base_caption: '1girl, 1boy, cafe', char_captions: [] } },
  v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } },
  ...over,
}) } }]).naiDict;

test('v4 본문이 최상위와 같으면 기타에 겹쳐 보이지 않는다', () => {
  const dict = naiV4({});
  assert.equal('v4_prompt.base_caption' in dict.etc, false);
  assert.equal('v4_negative_prompt.base_caption' in dict.etc, false);
});

test('v4 본문이 최상위와 다르면 기타에 나란히 보여준다', () => {
  const dict = naiV4({
    prompt: '3girls, beach',
    v4_prompt: { caption: { base_caption: '1girl, 1boy, cafe', char_captions: [] } },
  });
  assert.equal(dict.prompt, '3girls, beach');
  assert.equal(dict.etc['v4_prompt.base_caption'], '1girl, 1boy, cafe');
});

test('최상위 prompt 가 비어 있으면 v4 본문을 쓴다', () => {
  const dict = naiV4({ prompt: '', uc: '' });
  assert.equal(dict.prompt, '1girl, 1boy, cafe');
  assert.equal(dict.negative_prompt, 'lowres');
});

// ── JPEG / WebP 로 변환된 파일 ────────────────────────────

/** UserComment 하나만 든 TIFF 블록. */
function tiffWithUserComment(text) {
  const body = Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from(text, 'utf8')]);
  const tiff = Buffer.alloc(44 + body.length);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);          // IFD0 항목 1개
  tiff.writeUInt16LE(0x8769, 10);    // ExifIFDPointer
  tiff.writeUInt16LE(4, 12);         // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);        // ExifIFD 위치
  tiff.writeUInt32LE(0, 22);         // 다음 IFD 없음
  tiff.writeUInt16LE(1, 26);         // ExifIFD 항목 1개
  tiff.writeUInt16LE(0x9286, 28);    // UserComment
  tiff.writeUInt16LE(7, 30);         // UNDEFINED
  tiff.writeUInt32LE(body.length, 32);
  tiff.writeUInt32LE(44, 36);        // 값 위치
  tiff.writeUInt32LE(0, 40);
  body.copy(tiff, 44);
  return tiff;
}

const PARAMS = 'masterpiece, 1girl\nNegative prompt: lowres, bad hands\nSteps: 28, Sampler: Euler a, CFG scale: 7, Seed: 42';

test('JPEG 의 EXIF UserComment 에서 읽는다', () => {
  const tiff = tiffWithUserComment(PARAMS);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  const bytes = new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xd8]), app1, payload, Buffer.from([0xff, 0xd9]),
  ]));

  assert.equal(isJpeg(bytes), true);
  const info = readJpegMetadata(bytes);
  assert.equal(info.UserComment, PARAMS);

  const result = getNaiDict([{ label: 'EXIF', info }]);
  assert.equal(result.naiDict.prompt, 'masterpiece, 1girl');
  assert.equal(result.naiDict.negative_prompt, 'lowres, bad hands');
  assert.equal(result.naiDict.option.seed, 42);
});

test('WebP 의 EXIF 청크에서 읽는다', () => {
  const tiff = tiffWithUserComment(PARAMS);
  const exif = Buffer.alloc(8 + tiff.length + (tiff.length % 2));
  exif.write('EXIF', 0, 'latin1');
  exif.writeUInt32LE(tiff.length, 4);
  tiff.copy(exif, 8);

  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), exif]);
  const riff = Buffer.alloc(8 + body.length);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length, 4);
  body.copy(riff, 8);
  const bytes = new Uint8Array(riff);

  assert.equal(isWebp(bytes), true);
  const info = readWebpMetadata(bytes);
  assert.equal(info.UserComment, PARAMS);
  assert.equal(getNaiDict([{ label: 'EXIF', info }]).naiDict.prompt, 'masterpiece, 1girl');
});

test('JPEG 는 PNG 로 오인하지 않는다', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0]);
  assert.equal(isPng(jpeg), false);
  assert.equal(isJpeg(jpeg), true);
});
