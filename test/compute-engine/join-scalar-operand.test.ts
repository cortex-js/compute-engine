/**
 * `Join` appends a SCALAR operand as one element, like a tuple (ruled
 * 2026-09-03, Desmos parity: `join(L, 5)` and `join(1, 2, 3)`). A scalar used
 * to be an `incompatible-type` error at boxing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('L', { type: 'list<number>' });
ce.assign('L', ce.box(['List', 1, 2, 3]));

describe('a scalar operand is one element', () => {
  test('box route', () => {
    const e = ce.box(['Join', ['List', 1, 2, 3], 10]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('[1,2,3,10]');
    // The literal operands fold into one list literal at canonicalization,
    // whose type carries the shape.
    expect(String(e.type)).toBe('vector<integer^4>');
  });

  test('parse route', () => {
    const e = ce.parse('\\operatorname{join}(L, 5)');
    expect(e.isValid).toBe(true);
    expect(e.json).toEqual(['Join', 'L', ['List', 5]]);
    expect(e.evaluate().toString()).toBe('[1,2,3,5]');
  });

  test('every operand a scalar', () => {
    expect(ce.box(['Join', 1, 2, 3]).evaluate().toString()).toBe('[1,2,3]');
    expect(ce.box(['Join', 5]).evaluate().toString()).toBe('[5]');
  });

  test('a scalar ahead of a list, and a symbol declared a number', () => {
    ce.declare('k', 'number');
    ce.assign('k', 7);
    expect(
      ce.parse('\\operatorname{join}(0, L, k)').evaluate().toString()
    ).toBe('[0,1,2,3,7]');
  });

  test('the lazy accessors read the element', () => {
    const e = ce.box(['Join', 'L', 10]);
    expect(e.count).toBe(4);
    expect(e.at(4)?.toString()).toBe('10');
    expect(e.contains(ce.number(10))).toBe(true);
    expect(e.isEmptyCollection).toBe(false);
    expect(e.isFiniteCollection).toBe(true);
  });

  test('a set-kind join deduplicates the scalar', () => {
    expect(
      ce
        .box(['Join', ['Set', 1, 2], 2])
        .evaluate()
        .toString()
    ).toBe('Set(1, 2)');
  });

  test('a union whose every arm is atomic is one element', () => {
    ce.declare('m', 'integer | tuple<number, number>');
    const e = ce.box(['Join', 'L', 'm']);
    expect(e.isValid).toBe(true);
    expect(e.json).toEqual(['Join', 'L', ['List', 'm']]);
    ce.assign('m', ce.box(['Tuple', 4, 5]));
    expect(e.evaluate().toString()).toBe('[1,2,3,(4, 5)]');
  });

  test('an unknown-typed operand keeps the collection route and inference', () => {
    const ce2 = new ComputeEngine();
    const e = ce2.box(['Join', 'xs', 3]);
    expect(e.json).toEqual(['Join', 'xs', ['List', 3]]);
    expect(String(ce2.symbol('xs').type)).toBe('collection<any>');
    ce2.box(['Assign', 'xs', ['List', 1, 2]]).evaluate();
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });
});

describe('a scalar spread in a literal is one element', () => {
  test('list literal, eagerly', () => {
    const e = ce.box(['List', ['Spread', ['List', 1, 2]], 3, ['Spread', 4]]);
    expect(e.json).toEqual(['List', 1, 2, 3, 4]);
    expect(String(e.type)).toBe('vector<integer^4>');
  });

  test('list literal with a lazy segment keeps the scalar in its run', () => {
    const e = ce.box(['List', ['Spread', 'L'], ['Spread', 4], 5]);
    expect(e.json).toEqual(['Join', 'L', ['List', 4, 5]]);
    expect(e.evaluate().toString()).toBe('[1,2,3,4,5]');
  });

  test('set literal', () => {
    expect(
      ce.box(['Set', ['Spread', ['Set', 1, 2]], ['Spread', 2]]).toString()
    ).toBe('Set(1, 2)');
  });
});

describe('compiled targets append it as one element', () => {
  test('javascript: scalar and tuple operands', () => {
    const r = compile(ce.box(['Join', 'L', 10]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!()).toEqual([1, 2, 3, 10]);
    const t = compile(
      ce.box(['Join', ['List', ['Tuple', 0, 0]], ['Tuple', 1, 2]]),
      {
        to: 'javascript',
        fallback: false,
      }
    );
    expect(t.run!()).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  test('a tuple through an alias or an all-tuple union is one element on both targets', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('P', { type: 'list<tuple<number, number>>' });
    ce2.declare('q', 'tuple<number, number> | tuple<number, number, number>');
    const js = compile(ce2.box(['Join', 'P', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(js.run!({ P: [[0, 0]], q: [1, 2] })).toEqual([
      [0, 0],
      [1, 2],
    ]);
    const py = compile(ce2.box(['Join', 'P', 'q']), {
      to: 'python',
      fallback: false,
    });
    expect(py.code).toBe('[*P, q]');
  });

  test('python: the wrapped scalar is unpacked as one element', () => {
    ce.declare('M', 'list<number>');
    const r = compile(ce.box(['Join', 'M', 10]), {
      to: 'python',
      fallback: false,
    });
    expect(r.code).toBe('[*M, *[10]]');
  });
});
