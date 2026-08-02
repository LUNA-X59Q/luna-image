// 배지에 찍히는 모델 이름을 지킨다. Source 표기는 버전마다 달라서 규칙이 흔들리기 쉽다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNaiDict, modelLabel } from '../src/nai-dict.js';

test('NAI 의 Source 에서 버전만 뽑는다', () => {
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion V4.5 4BDE2A90' }), 'NOVEL AI 4.5');
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion V4 4F49EC75' }), 'NOVEL AI 4');
});

test('해시가 없어도 버전을 읽는다', () => {
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion V4.5' }), 'NOVEL AI 4.5');
});

test('버전 뒤에 붙은 0 은 떼어낸다', () => {
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion V4.50 ABCDEF12' }), 'NOVEL AI 4.5');
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion V5.0 ABCDEF12' }), 'NOVEL AI 5');
});

test('버전이 적혀 있지 않으면 이름만 보여준다', () => {
  // v3 이전은 Source 에 바탕 모델 이름만 적혀 있어 버전을 알 수 없다.
  assert.equal(modelLabel({ Source: 'Stable Diffusion XL C1E1DE52', Software: 'NovelAI' }), 'NOVEL AI');
  assert.equal(modelLabel({ Source: 'NovelAI Diffusion' }), 'NOVEL AI');
});

test('NAI 가 아니면 해시를 뗀 Source 를 그대로 쓴다', () => {
  assert.equal(modelLabel({ Source: 'Stable Diffusion XL C1E1DE52' }), 'STABLE DIFFUSION XL');
});

test('알아볼 값이 없으면 빈 문자열', () => {
  assert.equal(modelLabel({}), '');
  assert.equal(modelLabel(null), '');
  assert.equal(modelLabel({ Source: 42 }), '');
});

test('읽어낸 이미지 메타데이터에서 그대로 이어진다', () => {
  const comment = JSON.stringify({
    prompt: '1girl, cafe', uc: 'lowres', seed: 42,
    Source: 'NovelAI Diffusion V4.5 4BDE2A90',
  });
  const { naiDict } = getNaiDict([{ label: 'EXIF', info: { Comment: comment, Software: 'NovelAI' } }]);
  assert.equal(modelLabel(naiDict.etc), 'NOVEL AI 4.5');
});
