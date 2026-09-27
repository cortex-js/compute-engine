/**
 * The index of an `Element` clause takes the collection's element type
 * (`canonicalIndexingSet` in `library/utils.ts` for `Sum`/`Product`,
 * `canonicalLoopLike` in `library/control-structures.ts` for `Loop` and
 * `Comprehension`). A binder rebuilt from its canonical operands gets a new
 * scope, and `evaluate()` does that when a sum stays symbolic. The clause's
 * index symbol was still bound to the ORIGINAL scope, so the narrowing went to
 * that binding, the new scope's index stayed `unknown`, and the body typed it
 * `number`: the held `Sum(k², Element(k, Range(1, +∞)))` was typed `number`
 * where the original was `integer | nan | signed_infinity`.
 */

import { ComputeEngine } from '../../src/compute-engine';

const INF = { num: '+Infinity' };

describe('A BINDER REBUILT FROM ITS CANONICAL OPERANDS KEEPS ITS INDEX TYPE', () => {
  test.each([
    [['Sum', ['Power', 'k', 2], ['Element', 'k', ['Range', 1, INF]]]],
    [['Sum', ['Power', 'k', 2], ['Element', 'k', ['List', 1, 2, 3]]]],
    [
      [
        'Comprehension',
        ['Multiply', 10, 'i'],
        ['Element', 'i', ['List', 1, 2, 3]],
      ],
    ],
    [['Loop', ['Multiply', 10, 'i'], ['Element', 'i', ['List', 1, 2, 3]]]],
  ])('%j', (expr) => {
    const ce = new ComputeEngine();
    const e = ce.box(expr as never);
    const rebuilt = ce.function(e.operator, [...e.ops!]);
    expect(rebuilt.type.toString()).toBe(e.type.toString());
    expect(rebuilt.op1.type.toString()).toBe(e.op1.type.toString());
  });

  test('the held value of a sum over an infinite range keeps its type', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Sum',
      ['Power', 'k', 2],
      ['Element', 'k', ['Range', 1, INF]],
    ] as never);
    const held = e.evaluate();
    expect(held.operator).toBe('Sum');
    expect(held.type.toString()).toBe('integer | nan | signed_infinity');
  });

  test.each(['Sum', 'Comprehension', 'Loop'])(
    'an outer symbol with the same name is not narrowed: %s',
    (head) => {
      const ce = new ComputeEngine();
      ce.declare('k', 'real');
      const e = ce.box([
        head,
        ['Power', 'k', 2],
        ['Element', 'k', ['List', 1, 2, 3]],
      ] as never);
      ce.function(head, [...e.ops!]);
      expect(ce.box('k').type.toString()).toBe('real');
    }
  );

  test('the clause and the body of a rebuilt binder share one binding', () => {
    const ce = new ComputeEngine();
    for (const head of ['Sum', 'Comprehension']) {
      const e = ce.box([
        head,
        ['Power', 'k', 2],
        ['Element', 'k', ['List', 1, 2, 3]],
      ] as never);
      const rebuilt = ce.function(head, [...e.ops!]);
      const clauseIndex = rebuilt.op2.op1;
      const bodyIndex = rebuilt.op1.op1;
      expect(clauseIndex.valueDefinition).toBe(bodyIndex.valueDefinition);
    }
  });
});
