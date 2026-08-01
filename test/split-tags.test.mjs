// 태그는 쉼표로 나뉜다. NAI V4 가중치 묶음만 예외다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitTags } from '../src/tags.js';

test('쉼표로 나눈다', () => {
  assert.deepEqual(splitTags('1girl, blue sky, smile'), ['1girl', 'blue sky', 'smile']);
});

test('평범한 태그 안의 :: 가 뒤쪽 쉼표를 삼키지 않는다', () => {
  assert.deepEqual(
    splitTags('1girl, artist::name, blue sky, smile'),
    ['1girl', 'artist::name', 'blue sky', 'smile'],
  );
});

test('태그 끝에 붙은 :: 도 쉼표를 삼키지 않는다', () => {
  assert.deepEqual(splitTags('1girl, cat ears::, blue sky'), ['1girl', 'cat ears::', 'blue sky']);
});

test('NAI V4 가중치 묶음은 통째로 둔다', () => {
  assert.deepEqual(
    splitTags('1.5::blue eyes, blonde hair::, 1girl, smile'),
    ['1.5::blue eyes, blonde hair::', '1girl', 'smile'],
  );
});

test('가중치 묶음이 여러 개여도 각각 묶인다', () => {
  assert.deepEqual(splitTags('a::b, 1.5::c, d::'), ['a::b', '1.5::c, d::']);
});

test('닫히지 않은 가중치 묶음은 쉼표로 나눈다', () => {
  assert.deepEqual(
    splitTags('1girl, 1.5::blue eyes, blonde hair, smile'),
    ['1girl', '1.5::blue eyes', 'blonde hair', 'smile'],
  );
});

test('숫자로 끝나는 태그는 묶음을 열지 않는다', () => {
  assert.deepEqual(
    splitTags('artist2::name, 1girl, sky::'),
    ['artist2::name', '1girl', 'sky::'],
  );
});

test('중괄호 강조가 붙은 가중치 묶음도 알아본다', () => {
  assert.deepEqual(splitTags('{1.5::a, b::}, 1girl'), ['{1.5::a, b::}', '1girl']);
});

test('강조 끝의 쉼표가 만든 닫는 괄호 조각을 앞 태그에 붙인다', () => {
  assert.deepEqual(
    splitTags('{{best quality, amazing quality, very aesthetic,}}, 1girl'),
    ['{{best quality', 'amazing quality', 'very aesthetic}}', '1girl'],
  );
});

test('여는 괄호 조각은 다음 태그 앞에 붙인다', () => {
  assert.deepEqual(splitTags('{{, 1girl, blue sky}}'), ['{{1girl', 'blue sky}}']);
});

test('대괄호 · 소괄호 강조도 마찬가지다', () => {
  assert.deepEqual(splitTags('[[lowres, bad anatomy,]], watermark'), ['[[lowres', 'bad anatomy]]', 'watermark']);
  assert.deepEqual(splitTags('((worst quality, low quality,)), text'), ['((worst quality', 'low quality))', 'text']);
});

test('괄호만 남는 칩은 생기지 않는다', () => {
  const junk = splitTags('{{a, b,}}, [[c, d,]], ((e, f,)), g').filter((tag) => /^[{}[\]()]+$/.test(tag));
  assert.deepEqual(junk, []);
});

test('태그 보기로 복사해도 강조 괄호 짝이 맞는다', () => {
  const copied = splitTags('{{best quality, very aesthetic,}}, 1girl, [[blurry,]]').join(', ');
  assert.equal(copied, '{{best quality, very aesthetic}}, 1girl, [[blurry]]');
  const open = [...copied].filter((c) => c === '{' || c === '[').length;
  const close = [...copied].filter((c) => c === '}' || c === ']').length;
  assert.equal(open, close);
});

test('짝이 맞는 빈 강조는 버린다', () => {
  assert.deepEqual(splitTags('1girl, {{ }}, smile'), ['1girl', 'smile']);
});

test('기호로 된 태그는 그대로 둔다', () => {
  assert.deepEqual(
    splitTags('1girl, ^_^, >_<, :d, hatsune miku \\(cosplay\\)'),
    ['1girl', '^_^', '>_<', ':d', 'hatsune miku \\(cosplay\\)'],
  );
});

test('줄바꿈과 빈 태그를 걷어낸다', () => {
  assert.deepEqual(splitTags('1girl,\n  blue\n  sky, , smile'), ['1girl', 'blue sky', 'smile']);
});

test('빈 값은 빈 배열', () => {
  assert.deepEqual(splitTags(''), []);
  assert.deepEqual(splitTags(null), []);
  assert.deepEqual(splitTags(undefined), []);
});
