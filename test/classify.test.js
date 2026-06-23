import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCharger, classifyStatus } from '../lib/classify.js';

test('classifyCharger: DC콤보(04)는 급속', () => {
  const r = classifyCharger('04');
  assert.equal(r.speed, '급속');
  assert.ok(r.connectors.includes('DC콤보'));
});

test('classifyCharger: AC완속(02)은 완속', () => {
  assert.equal(classifyCharger('02').speed, '완속');
});

test('classifyCharger: 알 수 없는 코드는 급속+기타로 안전 처리', () => {
  const r = classifyCharger('99');
  assert.equal(r.connectors[0], '기타');
});

test('classifyStatus: 2=충전대기는 사용가능', () => {
  const r = classifyStatus('2');
  assert.equal(r.available, true);
});

test('classifyStatus: 3=충전중은 사용불가', () => {
  assert.equal(classifyStatus('3').available, false);
});
