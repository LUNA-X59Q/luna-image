// 프롬프트와 네거티브 프롬프트가 서로 섞이지 않는지 지킨다.
// 의존성 없이 `node --test test/` 로 돌린다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWebuiExif } from '../src/nai-dict.js';
import { comfyToExifDict } from '../src/comfy.js';

// ── WebUI parameters ──────────────────────────────────────

const OPTIONS = 'Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: 42, Size: 832x1216';

test('여러 줄 네거티브 프롬프트가 잘리지 않는다', () => {
  const dict = parseWebuiExif(
    `masterpiece, 1girl\nNegative prompt: lowres, bad anatomy,\nworst quality, watermark\n${OPTIONS}`,
  );
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.negative_prompt, 'lowres, bad anatomy,\nworst quality, watermark');
  assert.equal(dict.steps, 28);
});

test('여러 줄 프롬프트가 네거티브로 새지 않는다', () => {
  const dict = parseWebuiExif(
    `masterpiece,\nbest quality, 1girl\nNegative prompt: lowres\n${OPTIONS}`,
  );
  assert.equal(dict.prompt, 'masterpiece,\nbest quality, 1girl');
  assert.equal(dict.negative_prompt, 'lowres');
});

test('프롬프트가 비어 있어도 네거티브를 알아본다', () => {
  const dict = parseWebuiExif(`Negative prompt: lowres, bad anatomy\n${OPTIONS}`);
  assert.equal(dict.prompt, '');
  assert.equal(dict.negative_prompt, 'lowres, bad anatomy');
});

test('네거티브 마지막 줄의 (태그:가중치) 를 옵션으로 착각하지 않는다', () => {
  const dict = parseWebuiExif(
    `1girl\nNegative prompt: lowres,\n(bad hands:1.2), (bad anatomy:1.3), (worst quality:1.4)\n${OPTIONS}`,
  );
  assert.equal(dict.negative_prompt, 'lowres,\n(bad hands:1.2), (bad anatomy:1.3), (worst quality:1.4)');
  assert.equal(dict.sampler, 'Euler a');
});

test('옵션 줄이 없으면 전부 프롬프트와 네거티브로 남는다', () => {
  const dict = parseWebuiExif('masterpiece, 1girl\nNegative prompt: lowres, bad hands');
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.negative_prompt, 'lowres, bad hands');
});

test('따옴표 안의 쉼표는 옵션을 가르지 않는다', () => {
  const dict = parseWebuiExif(`1girl\n${OPTIONS}, Lora hashes: "a: 1a2b, b: 3c4d"`);
  assert.equal(dict['lora hashes'], 'a: 1a2b, b: 3c4d');
});

// ── ComfyUI 그래프 ────────────────────────────────────────

test('출력이 둘인 프롬프트 노드를 극성으로 갈라낸다', () => {
  const dict = comfyToExifDict({
    1: { class_type: 'SDXLPromptStyler', inputs: { text_positive: 'masterpiece, 1girl', text_negative: 'lowres, bad hands', style: 'base' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: ['1', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: ['1', 1] } },
    4: { class_type: 'KSampler', inputs: { positive: ['2', 0], negative: ['3', 0], steps: 28 } },
  });
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.uc, 'lowres, bad hands');
});

test('positive_prompt · negative_prompt 를 한 노드에 담아도 갈라낸다', () => {
  const dict = comfyToExifDict({
    1: { class_type: 'CR Prompt Text', inputs: { positive_prompt: 'masterpiece, 1girl', negative_prompt: 'lowres, worst quality' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: ['1', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: ['1', 1] } },
    4: { class_type: 'KSampler', inputs: { positive: ['2', 0], negative: ['3', 0], steps: 20 } },
  });
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.uc, 'lowres, worst quality');
});

test('SDXL 인코더의 text_g · text_l 은 그대로 합쳐진다', () => {
  const dict = comfyToExifDict({
    1: { class_type: 'CLIPTextEncodeSDXL', inputs: { text_g: 'masterpiece', text_l: '1girl' } },
    2: { class_type: 'CLIPTextEncodeSDXL', inputs: { text_g: 'lowres', text_l: 'bad hands' } },
    3: { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: ['2', 0], steps: 20 } },
  });
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.uc, 'lowres, bad hands');
});

test('제목이 없어도 연결 관계로 네거티브 인코더를 가려낸다', () => {
  const dict = comfyToExifDict({
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, 1girl', clip: ['9', 0] } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad anatomy', clip: ['9', 0] } },
    4: { class_type: 'SomeCustomSampler', inputs: { neg_cond: ['2', 0], steps: 20 } },
    9: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  });
  assert.equal(dict.prompt, 'masterpiece, 1girl');
  assert.equal(dict.uc, 'lowres, bad anatomy');
});
