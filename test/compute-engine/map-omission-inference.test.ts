import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import { expectTypeBetween } from '../utils';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

describe('Map omission inference preserves the remaining data contract', () => {
  test.each(['any', 'list<any>'])(
    '%s retains nested collections, missing data and omission',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('xs', type);
      ce.assign('xs', ce.box(['List', ['List', 1, 'Missing'], ['List', 4]]));
      const map = ce.box(['Map', 'Sqrt', 'xs']);
      expectTypeBetween(map, {
        atMost: 'list<indexed_collection<any> | number | nothing>',
      });
      expect(isSubtype('nothing', collectionElementType(map.type.type)!)).toBe(
        true
      );
      const value = map.evaluate({ materialization: true });
      expect(isSubtype(value.type.type, map.type.type)).toBe(true);
    }
  );

  test('a known callable with an opaque result does not borrow its input type', () => {
    const ce = new ComputeEngine();
    ce.declare('Opaque', {
      signature: '(integer) -> any',
      evaluate: () => ce.string('result'),
    });
    const map = ce.box(['Map', 'Opaque', ['List', 1, 2]]);
    expectTypeBetween(map, { atMost: 'list<any>', atLeast: 'list<any>' });
    expect(compile(map).success).toBe(false);
    expect(map.evaluate({ materialization: true }).json).toEqual([
      'List',
      "'result'",
      "'result'",
    ]);
  });

  test.each(['First', 'PointX'])(
    '%s over strings returns characters rather than echoing string elements',
    (head) => {
      const ce = new ComputeEngine();
      const map = ce.box(['Map', head, ['List', "'a'", "'b'"]]);
      expectTypeBetween(map, { atMost: 'list<character | missing>' });
      expect([...map.each()].map((x) => x.type.toString())).toEqual([
        'character',
        'character',
      ]);
    }
  );
});

describe('compiled Map proves omission separately from a broad result type', () => {
  test.each([[7], [['Multiply', 2, 'u']]])(
    'a tuple callback returning %j compiles',
    (body) => {
      const ce = new ComputeEngine();
      ce.declare('points', 'list<tuple<real, real>>');
      const expr = ce.box(['Apply', ['Function', body, 'u'], 'points']);
      const result = compile(expr);
      expect(result.success).toBe(true);
      expect(
        result.run!({
          points: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toEqual(
        body === 7
          ? [7, 7]
          : [
              [2, 4],
              [6, 8],
            ]
      );
    }
  );

  test.each(
    [
      ['If', 'c', 'Nothing', 7],
      ['N', ['If', 'c', 'Nothing', 7]],
      ['Block', ['If', 'c', ['Return', 'Nothing']], 7],
      ['Return', ['Block', ['If', 'c', ['Return', 'Nothing']], 7]],
    ].map((body) => [body])
  )('an omission on a return path remains refused: %j', (body) => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const map = ce.box(['Map', ['Function', body, 'u'], ['List', 1, 2]]);
    expect(compile(map).success).toBe(false);
  });

  test('a function-valued parameter cannot borrow a global function proof', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'x']));
    ce.declare('Invoke', '(function) -> any');
    ce.assign(
      'Invoke',
      ce.box(['Function', ['Apply', 'h', 1], ['Typed', 'h', 'function']])
    );
    ce.declare('callbacks', 'list<function>');
    const result = compile(ce.box(['Map', 'Invoke', 'callbacks']));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });

  test.each(['(real) -> any', '(real) -> unknown', 'function'])(
    'an enclosing %s parameter cannot borrow a global callback proof',
    (type) => {
      const ce = new ComputeEngine();
      ce.assign('h', ce.box(['Function', 7, 'u']));
      const expr = ce.box([
        'Function',
        ['Map', 'h', ['List', 1, 2]],
        ['Typed', 'h', type],
      ]);
      const result = compile(expr);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
      const safe = compile(ce.box(['Map', 'h', ['List', 1, 2]]));
      expect(safe.success).toBe(true);
      expect(safe.run!({})).toEqual([7, 7]);
    }
  );

  test('an untyped inner parameter shadows an outer callable contract', () => {
    const ce = new ComputeEngine();
    const build = (inner: any) =>
      ce.box([
        'Function',
        ['Function', ['Map', 'h', ['List', 1, 2]], inner],
        ['Typed', 'h', '(real) -> real'],
      ]);
    expect(compile(build('h')).success).toBe(false);
    expect(compile(build(['Typed', 'h', '(real) -> real'])).success).toBe(true);
  });

  test('a loop callback cannot borrow the contract of a shadowed parameter', () => {
    const source =
      'function run(h: (real) -> real, fs: list<function>) { ' +
      'let out = []; for h in fs { out = [...out, map(h, [1, 2])] }; out }\nrun';
    const build = (src: string) => {
      const ce = new ComputeEngine();
      const [program, diagnostics] = parseEpsil(src);
      expect(diagnostics).toEqual([]);
      return compile(ce.box(resolveLibraryNames(program, src, ce)));
    };
    const shadowed = build(source);
    expect(shadowed.success).toBe(false);
    expect(shadowed.error).toMatch(/Nothing/);
    const captured = build(source.replace('for h in fs', 'for item in fs'));
    expect(captured.success).toBe(true);
    const run = captured.run!({}) as Function;
    expect(run((x: number) => 2 * x, [() => undefined])).toEqual([[2, 4]]);
  });

  test.each([false, true])(
    'a loop shadows outer callable provenance (mutable: %s)',
    (mutable) => {
      const source =
        'function run(fs: list<function>) { let h = (k) => k + 1; ' +
        (mutable ? 'h = (k) => k * 2; ' : '') +
        'let out = []; for h in fs { out = [...out, map(h, [1, 2])] }; out }\nrun';
      const build = (src: string) => {
        const ce = new ComputeEngine();
        const [program, diagnostics] = parseEpsil(src);
        expect(diagnostics).toEqual([]);
        return compile(ce.box(resolveLibraryNames(program, src, ce)));
      };
      const shadowed = build(source);
      expect(shadowed.success).toBe(false);
      expect(shadowed.error).toMatch(/Nothing/);
      const captured = build(source.replace('for h in fs', 'for item in fs'));
      expect(captured.success).toBe(true);
      const run = captured.run!({}) as Function;
      expect(run([() => undefined])).toEqual([mutable ? [2, 4] : [2, 3]]);
    }
  );

  test('a declared mutable callback cannot hide a visible omitted return', () => {
    const source =
      'let h: (real) -> real = (k: real) => do { if flag { Return(7) }; 7 }\n' +
      'h = (k: real) => do { if flag { Return(Nothing) }; 7 }\n' +
      'listFrom(map(h, [1, 2]))';
    const build = (src: string) => {
      const ce = new ComputeEngine();
      ce.declare('flag', 'boolean');
      const [program, diagnostics] = parseEpsil(src);
      expect(diagnostics).toEqual([]);
      return compile(ce.box(resolveLibraryNames(program, src, ce)));
    };
    const omitted = build(source);
    expect(omitted.success).toBe(false);
    expect(omitted.error).toMatch(/Nothing/);
    const numeric = build(source.replace('Return(Nothing)', 'Return(9)'));
    expect(numeric.success).toBe(true);
    expect(numeric.run!({ flag: true })).toEqual([9, 9]);
  });

  test('a numeric callback does not justify an omission-capable source', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<any>');
    expect(compile(ce.box(['Map', ['Function', 7, 'u'], 'xs'])).success).toBe(
      false
    );
  });

  test('unconstrained aggregate parameters still need a non-omitting contract', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.box(['Mean', 'x'])).success).toBe(false);
    ce.declare('ys', 'list<real>');
    expect(compile(ce.box(['Mean', 'ys'])).success).toBe(true);
  });
});
