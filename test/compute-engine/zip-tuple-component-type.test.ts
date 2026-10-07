import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The static type of a `Zip` element when a source has no known element type.
//
// `Zip(xs, ys)` is a list of tuples with one component per source. A source
// whose element type is not known (a bare `list`, or `Repeat(u, 3)` for a
// `u` of unknown type) gives an `unknown` COMPONENT, and a `list<any>` source
// an `any` component; the arity and the other components stay known. Before
// this, the whole result fell back to a bare `list`. A callback parameter bound to an
// element of the zip was then valueless, and its first use narrowed it: in
// `p => !p[1] if p[2] % 2 == 0 else p[1]`, the use `p[2] % 2` narrowed `p`
// to `indexed_collection<real>`, so `!p[1]` was refused with "expected
// `boolean`, got `nan | real`".
//
// `Repeat(v, n)` is typed `list<T>`, with `T` the type of `v`. Before, it was
// a bare `list`, so `let open = repeat(false, 3)` gave `open` no element type
// and `zip(open, 1..3)` reached the case above.
//

const ce = new ComputeEngine();
ce.declare('xs', 'list<boolean>');
ce.declare('ys', 'list');
ce.declare('u', 'unknown');

describe('ZIP ELEMENT TYPE', () => {
  test('a declared element type gives a typed component', () => {
    expect(ce.box(['Zip', 'xs', ['Range', 1, 3]]).type.toString()).toBe(
      'list<tuple<boolean, integer>>'
    );
    expect(
      ce
        .box(['At', ['At', ['Zip', 'xs', ['Range', 1, 3]], 1], 1])
        .type.toString()
    ).toBe('boolean | missing');
  });

  test('a declared bare `list` source gives an `unknown` component', () => {
    expect(ce.box(['Zip', 'ys', ['Range', 1, 3]]).type.toString()).toBe(
      'list<tuple<unknown, integer>>'
    );
    expect(ce.box(['Zip', 'ys', 'xs']).type.toString()).toBe(
      'list<tuple<unknown, boolean>>'
    );
    expect(
      ce
        .box(['At', ['At', ['Zip', 'ys', ['Range', 1, 3]], 1], 1])
        .type.toString()
    ).toBe('unknown');
    expect(
      ce
        .box(['At', ['At', ['Zip', 'ys', ['Range', 1, 3]], 1], 2])
        .type.toString()
    ).toBe('integer | nan');
  });

  test('an explicit `any` element type stays `any` (absence markers admitted)', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('la', 'list<any>');
    expect(ce2.box(['Zip', 'la', ['Range', 1, 3]]).type.toString()).toBe(
      'list<tuple<any, integer>>'
    );
  });

  test('a `Repeat` of a value of unknown type gives an `unknown` component', () => {
    expect(
      ce.box(['Zip', ['Repeat', 'u', 3], ['Range', 1, 3]]).type.toString()
    ).toBe('list<tuple<unknown, integer>>');
  });

  test('a callback that reads both components of an unknown-component pair is valid', () => {
    const body = [
      'If',
      ['Equal', ['Mod', ['At', 'p', 2], 2], 0],
      ['Not', ['At', 'p', 1]],
      ['At', 'p', 1],
    ];
    const expr = ce.box([
      'Map',
      ['Function', body, 'p'],
      ['Zip', 'ys', ['Range', 1, 3]],
    ]);
    expect(expr.isValid).toBe(true);
  });

  test('the same callback over a zipped `Repeat` evaluates', () => {
    const body = [
      'If',
      ['Equal', ['Mod', ['At', 'p', 2], 2], 0],
      ['Not', ['At', 'p', 1]],
      ['At', 'p', 1],
    ];
    const expr = ce.box([
      'Map',
      ['Function', body, 'p'],
      ['Zip', ['Repeat', 'False', 3], ['Range', 1, 3]],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('["False","True","False"]');
  });
});

describe('REPEAT ELEMENT TYPE', () => {
  test('the element type is the type of the repeated value', () => {
    expect(ce.box(['Repeat', 'False', 3]).type.toString()).toBe(
      'list<boolean>'
    );
    // A number is widened as in a list literal: `[1, 1, 1]` holds integers.
    expect(ce.box(['Repeat', 1, 3]).type.toString()).toBe('list<integer>');
    expect(ce.box(['Repeat', { str: 'a' }, 2]).type.toString()).toBe(
      'list<string>'
    );
  });

  test('a value of unknown type gives the bare `list`', () => {
    expect(ce.box(['Repeat', 'u']).type.toString()).toBe('list');
    expect(ce.box(['Repeat', 'u', 3]).type.toString()).toBe('list');
  });

  test('the infinite form has the same element type', () => {
    const r = ce.box(['Repeat', 1]);
    expect(r.type.toString()).toBe('list<integer>');
    expect(r.count).toBe(Infinity);
  });

  test('the evaluated list is a subtype of the static type', () => {
    for (const v of ['False', 1, { str: 'a' }]) {
      const r = ce.box(['Repeat', v, 3]);
      expect(r.evaluate().type.matches(r.type)).toBe(true);
    }
  });

  test('a zipped `Repeat` gives a typed component', () => {
    expect(
      ce.box(['Zip', ['Repeat', 'False', 3], ['Range', 1, 3]]).type.toString()
    ).toBe('list<tuple<boolean, integer>>');
  });
});

describe('ZIP ELEMENT TYPE — EPSIL PROGRAMS', () => {
  function run(source: string): {
    diagnostics: unknown[];
    text: string;
    engine: ComputeEngine;
  } {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(engine, source);
    return { diagnostics, text: value.toString(), engine };
  }

  test('the toggle loop over `zip(repeat(false, n), 1..n)` is accepted', () => {
    // Pass 1 opens every door, pass 2 closes door 2, pass 3 closes door 3:
    // only the perfect square 1 stays open.
    const { diagnostics, text, engine } = run(
      [
        'let open = repeat(false, 3)',
        'for pass in 1..3 {',
        '  open = map(p => !p[1] if p[2] % pass == 0 else p[1], zip(open, 1..3))',
        '}',
        'open',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(text).toBe('["True","False","False"]');
    expect(engine.symbol('open').type.matches('list<boolean>')).toBe(true);
  });

  test('the same `map` outside a loop is accepted', () => {
    const { diagnostics, text } = run(
      [
        'let open = repeat(false, 3)',
        'open = map(p => !p[1] if p[2] % 2 == 0 else p[1], zip(open, 1..3))',
        'open',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(text).toBe('["False","True","False"]');
  });

  test('the top-level form without a condition is accepted', () => {
    const { diagnostics, text } = run(
      [
        'let open = repeat(false, 3)',
        'listFrom(map(p => !p[1], zip(open, 1..3)))',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(text).toBe('["True","True","True"]');
  });
});
