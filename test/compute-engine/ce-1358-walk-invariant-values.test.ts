import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// CE-1358: a `Map` or `Filter` callback that reads one element of a list
// expression that does not depend on the element (`At(Abs(C), j)`) evaluated
// that list expression again at each element, so the walk took a time that
// grows with the square of the length. The walk now evaluates such a
// sub-expression once (`boxed-expression/walk-invariant-values.ts`).
//
// The tests count the evaluations of the list with a pure host function
// `Count`, which returns its argument, and check each value.
//

function engine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('Count', {
    signature: '(any) -> any',
    pure: true,
    evaluate: ([x]) => {
      calls += 1;
      return x.evaluate();
    },
  });
  return { ce, calls: () => calls };
}

const list = (ce: ComputeEngine, xs: number[]): Expression =>
  ce.box(['List', ...xs]);

const values = (x: Expression): unknown[] =>
  [...x.each()].map((e) => e.json);

describe('CE-1358 THE INVARIANT LIST OF A CALLBACK IS EVALUATED ONCE PER WALK', () => {
  test('Map with At of a list expression', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [-1, 2, -3, 4, -5, 6]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          ['Function', ['At', ['Count', ['Abs', 'L']], 'j'], 'j'],
          ['Range', 1, 6],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 1, 2, 3, 4, 5, 6]);
    expect(calls()).toBe(1);
  });

  test('Map with two sources (zip)', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [10, 20, 30]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          [
            'Function',
            ['Add', ['At', ['Count', 'L'], 'i'], 'k'],
            'i',
            'k',
          ],
          ['Range', 1, 3],
          ['List', 1, 2, 3],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 11, 22, 33]);
    expect(calls()).toBe(1);
  });

  test('Map with a selection over two list expressions', () => {
    const { ce, calls } = engine();
    ce.assign('A', list(ce, [1, 5, 2, 7]));
    const c = ['Less', 2, ['Count', ['Multiply', 2, 'A']]];
    const v = ['Count', ['Add', 'A', 10]];
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          [
            'Function',
            ['Which', ['At', c, 'j'], ['At', v, 'j'], 'True', 'NaN'],
            'j',
          ],
          ['Range', 1, 4],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 'NaN', 15, 12, 17]);
    expect(calls()).toBe(2);
  });

  test('A list under a scalar reduction is evaluated once', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [-1, 2, -4]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          [
            'Function',
            ['Add', 'j', ['Max', ['Count', ['Abs', 'L']]]],
            'j',
          ],
          ['Range', 1, 4],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 5, 6, 7, 8]);
    expect(calls()).toBe(1);
  });

  test('Filter with a mask over a list expression', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [0, 2, 0, 4, 5]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Filter',
          ['Range', 1, 5],
          ['Function', ['Less', 0, ['At', ['Count', ['Abs', 'L']], 'i']], 'i'],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 2, 4, 5]);
    expect(calls()).toBe(1);
  });

  test('A sub-expression that reads the parameter is evaluated at each element', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [1, 2, 3]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          [
            'Function',
            ['At', ['Count', ['Multiply', 'j', 'L']], 'j'],
            'j',
          ],
          ['Range', 1, 3],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 1, 4, 9]);
    expect(calls()).toBe(3);
  });

  test('A sub-expression that reads a local of the body is evaluated at each element', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [1, 2, 3]));
    const r = ce
      .box([
        'ListFrom',
        [
          'Map',
          [
            'Function',
            [
              'Block',
              ['Declare', 'M', "'list<integer>'", ['Multiply', 'j', 'L']],
              ['At', ['Count', 'M'], 'j'],
            ],
            'j',
          ],
          ['Range', 1, 3],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 1, 4, 9]);
    expect(calls()).toBe(3);
  });

  test('A sub-expression that reads a parameter of an enclosing function', () => {
    const { ce, calls } = engine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'ListFrom',
          [
            'Map',
            ['Function', ['At', ['Count', ['Abs', 'v']], 'j'], 'j'],
            ['Range', 1, 3],
          ],
        ],
        ['Typed', 'v', "'list<integer>'"],
      ])
    );
    expect(ce.box(['f', ['List', -1, -2, -3]]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    expect(ce.box(['f', ['List', -4, -5, -6]]).evaluate().json).toEqual([
      'List',
      4,
      5,
      6,
    ]);
    // `v` reads the activation of the call of `f`: `Count(Abs(v))` is
    // evaluated at each element, 3 times per call.
    expect(calls()).toBe(6);
  });

  test('A write between two elements of a walk is seen by the next element', () => {
    const { ce, calls } = engine();
    ce.assign('L', list(ce, [1, 2, 3]));
    const m = ce
      .box([
        'Map',
        ['Function', ['At', ['Count', ['Abs', 'L']], 'j'], 'j'],
        ['Range', 1, 3],
      ])
      .evaluate();
    const it = m.each();
    expect(it.next().value?.json).toBe(1);
    expect(it.next().value?.json).toBe(2);
    const before = calls();
    ce.assign('L', list(ce, [10, 20, 30]));
    expect(it.next().value?.json).toBe(30);
    expect(calls()).toBe(before + 1);
  });

  test('The values are the same with each read of the lazy result', () => {
    const { ce } = engine();
    ce.assign('L', list(ce, [3, -1, 4]));
    const m = ce
      .box([
        'Map',
        ['Function', ['At', ['Count', ['Abs', 'L']], 'j'], 'j'],
        ['Range', 1, 3],
      ])
      .evaluate();
    expect(values(m)).toEqual([3, 1, 4]);
    expect(values(m)).toEqual([3, 1, 4]);
    expect(m.at(2)?.json).toBe(1);
  });
});
