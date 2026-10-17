import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// The mapping literal of a lazy broadcast map (`lazyBroadcastMap`,
// `collection-utils.ts`) is built with each bare parameter pre-declared at the
// element type of its source, and the auto-declaration of a parameter at its
// first reference does not advance the `any` axis (`axisMaskOf`,
// `engine-configuration-lifecycle.ts`). Building a lazy map during an
// evaluation then retires neither the cached types nor the inert evaluation
// memo of the trees the evaluation holds (the profile of the chain of Tycho
// ledger row 380 counted about twenty advances per level from these maps).

function lazyMap(ce: ComputeEngine, json: unknown): Expression {
  const v = ce.box(json as never).evaluate();
  if (!isFunction(v, 'Map') || !isFunction(v.op1, 'Function'))
    throw new Error(`expected a lazy Map, got ${v.toString()}`);
  return v;
}

function anyVersion(ce: ComputeEngine): number {
  return (ce as unknown as { _anyVersion: number })._anyVersion;
}

describe('the parameters of a lazy broadcast map', () => {
  test('are bare symbols typed from the element type of their source', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    const map = lazyMap(ce, ['Add', ['Range', 1, 'N'], 1]);
    const fn = (map as Expression & { op1: Expression }).op1;
    if (!isFunction(fn)) throw new Error('expected a function literal');
    // A bare symbol, not a `Typed` annotation: the printed literal is
    // unchanged, and the lazy point-list projection (`projectLazyPointList`)
    // still matches the parameter by name.
    const param = fn.ops[1];
    expect(isSymbol(param)).toBe(true);
    expect(map.json).toEqual([
      'Map',
      ['Function', ['Block', ['Add', '_1', 1]], '_1'],
      ['Range', 1, 'N'],
    ]);
    // The parameter's binding carries the element type of the source, as the
    // body's use would have inferred it. (The literal's printed signature
    // keeps an inferred parameter `unknown`: the type is a binding, not an
    // annotation.)
    expect(param.type.toString()).toBe('integer');
  });

  test('building a lazy map does not advance the any axis', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    ce.declare('a', { type: 'list<number>' });
    ce.assign(
      'a',
      ce.box([
        'Map',
        ['Function', ['Divide', 'i', 'N'], 'i'],
        ['Range', 0, 'N'],
      ])
    );
    // Warm up: the first evaluation may declare `_1` once in the scope
    // chain, and the first read of `a` has its own costs.
    lazyMap(ce, ['Add', 'a', 1]);
    const before = anyVersion(ce);
    const map = lazyMap(ce, ['Multiply', 2, 'a']);
    expect(isFunction(map, 'Map')).toBe(true);
    expect(anyVersion(ce)).toBe(before);
  });

  test('the map keeps the semantics of its source', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    const map = lazyMap(ce, ['Add', ['Range', 1, 'N'], 1]);
    ce.assign('N', 3);
    expect(map.evaluate().toString()).toBe('[2,3,4]');
  });
});
