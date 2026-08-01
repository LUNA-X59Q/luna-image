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

test('줄바꿈과 빈 태그를 걷어낸다', () => {
  assert.deepEqual(splitTags('1girl,\n  blue\n  sky, , smile'), ['1girl', 'blue sky', 'smile']);
});

test('빈 값은 빈 배열', () => {
  assert.deepEqual(splitTags(''), []);
  assert.deepEqual(splitTags(null), []);
  assert.deepEqual(splitTags(undefined), []);
});
