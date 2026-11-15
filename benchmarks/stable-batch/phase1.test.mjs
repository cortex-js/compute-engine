import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Phase1Adapter, observable } from './phase1-adapter.mjs';
import { prepareBatch } from '../../src/compute-engine/experimental/stable-batch.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url))).fixtures;
export function runFixtures() {
  const adapters = [];
  for (const fixture of fixtures.filter(x => x.requiredPhase === 1)) {
    const adapter = new Phase1Adapter();
    for (const step of fixture.steps) {
      const result = observable(adapter.step(step));
      assert.partialDeepStrictEqual(result, step.expect, `${fixture.id}/${step.id}`);
    }
    checkInvariants(fixture, adapter);
    adapters.push(adapter);
  }
  return adapters;
}
function checkInvariants(fixture, adapter) {
  for (const record of adapter.records.values()) {
    if (!record.unit) continue;
    assert(Object.isFrozen(record.unit));
    assert(Object.isFrozen(record.unit.bindings));
    for (const binding of record.unit.bindings) assert(Object.isFrozen(binding));
  }
  if (fixture.id === 'F01' || fixture.id === 'F07') {
    const unit = adapter.unit('u');
    assert.equal(unit.binding('x').type, 'real');
    const binding = unit.binding('x');
    const instance = adapter.instance('i');
    for (let i = 0; i < 20; i++) instance.write('x', i);
    assert.strictEqual(unit.binding('x'), binding);
    assert.equal(binding.type, 'real');
  }
  if (fixture.id === 'F02') for (const name of ['f', 'g']) assert.equal(adapter.unit('a').binding(name).type, adapter.unit('b').binding(name).type);
  if (fixture.id === 'F03') {
    assert.notStrictEqual(adapter.unit('old'), adapter.unit('new'));
    assert.equal(adapter.instance('old').evaluate('answer').value.json, 7);
  }
  if (fixture.id === 'F04') {
    assert.equal(adapter.unit('numeric').binding('free').type, 'number');
    assert.equal(adapter.unit('logical').binding('free').type, 'boolean');
    assert.equal(adapter.engine.symbolInfo('free').type.toString(), 'unknown');
  }
  if (fixture.id === 'F06') assert.equal(adapter.instance('old').evaluate('answer').value.json, 6);
  if (fixture.id === 'F08') for (const name of ['data', 'text', 'n']) assert.deepEqual(adapter.instance('a').evaluate(name).value.json, adapter.instance('b').evaluate(name).value.json);
}

test('frozen F01–F09 execute and preserve observed revision invariants', runFixtures);
test('input syntax and external definition bodies are copied before publication', () => {
  const adapter = new Phase1Adapter();
  const entries = [{ kind: 'expression', name: 'answer', body: ['Add', 1, 2] }];
  const result = prepareBatch(adapter.engine, entries);
  entries[0].body[1] = 99;
  assert.equal(result.unit.instantiate().instance.evaluate('answer').value.json, 3);
  assert(Object.isFrozen(result.unit.source[0].body));
});
test('broader execution and mutable callable input explicitly refuse', () => {
  const adapter = new Phase1Adapter();
  for (const body of [['Program', 1], ['Sin', 1], ['If', 'True', 1, 2]]) assert.equal(prepareBatch(adapter.engine, [{ kind: 'expression', name: 'answer', body }]).status, 'unsupported');
  const value = prepareBatch(adapter.engine, [{ kind: 'expression', name: 'view', body: ['Range', 1, 3] }]);
  assert.equal(value.unit.instantiate().instance.evaluate('view').status, 'unsupported');
});

test('runtime writes preserve descriptors and reject nonfinite real and tuple values', () => {
  const adapter = new Phase1Adapter();
  const result = prepareBatch(adapter.engine, [{ kind: 'slot', name: 'x', type: 'real', initializer: 2 }]);
  const instance = result.unit.instantiate().instance;
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(instance.write('x', value).accepted, false);
  assert.equal(instance.write('x', ['Tuple', 1, 2]).status, 'unsupported');
  assert.equal(instance.evaluate('x').value.json, 2);
  assert.equal(result.unit.binding('x').type, 'real');
});
test('free occurrences share the final direct binding requirement', () => {
  const adapter = new Phase1Adapter();
  const result = prepareBatch(adapter.engine, [{ kind: 'expression', name: 'first', body: 'free' }, { kind: 'expression', name: 'second', body: ['Add', 'free', 1] }]);
  assert.equal(result.unit.binding('first').node.type, 'number');
  assert.strictEqual(result.unit.binding('first').node.binding, result.unit.binding('free'));
});
test('refused transfers preserve both runtime instances', () => {
  const adapter = new Phase1Adapter();
  const fixture = fixtures.find(x => x.id === 'F08');
  for (const step of fixture.steps.slice(0, 5)) adapter.step(step);
  const snapshot = id => ['data', 'text', 'n'].map(name => observable(adapter.instance(id).evaluate(name)));
  for (const step of fixture.steps.slice(5)) {
    const before = [snapshot('a'), snapshot('b')];
    assert.equal(adapter.step(step).status, 'unsupported');
    assert.deepEqual([snapshot('a'), snapshot('b')], before);
  }
});
test('runtime writes do not call preparation or general boxing', () => {
  const adapter = new Phase1Adapter();
  const result = prepareBatch(adapter.engine, [{ kind: 'slot', name: 'x', type: 'real' }]);
  const instance = result.unit.instantiate().instance;
  adapter.engine.box = () => { throw new Error('general boxing during write'); };
  for (let i = 0; i < 100; i++) assert.equal(instance.write('x', i).accepted, true);
  assert.equal(result.unit.binding('x').type, 'real');
});

test('numeric object syntax admits finite typed values at the literal boundary', () => {
  const adapter = new Phase1Adapter();
  const result = prepareBatch(adapter.engine, [{ kind: 'slot', name: 'x', type: 'real' }, { kind: 'slot', name: 'data', type: 'list<integer>' }]);
  const instance = result.unit.instantiate().instance;
  assert.equal(instance.write('x', { num: '3' }).accepted, true);
  assert.equal(instance.evaluate('x').value.json, 3);
  assert.equal(instance.write('x', { num: '3.5' }).accepted, true);
  assert.equal(instance.write('data', ['List', { num: '3' }, { num: '4' }]).accepted, true);
  for (const num of ['NaN', '+Infinity', '-Infinity']) assert.equal(instance.write('x', { num }).accepted, false);
  assert.equal(instance.evaluate('x').value.json, 3.5);
});
