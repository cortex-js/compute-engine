import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import { expectTypeBetween } from '../utils';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

describe('Map result-type inference preserves the remaining data contract', () => {
  test.each(['any', 'list<any>'])(
    '%s retains nested collections and missing data',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('xs', type);
      ce.assign('xs', ce.box(['List', ['List', 1, 'Missing'], ['List', 4]]));
      const map = ce.box(['Map', 'Sqrt', 'xs']);
      // `Sqrt(Missing)` is `Missing`, so the elements can be absent.
      expectTypeBetween(map, {
        atMost: 'list<indexed_collection<any> | missing | number>',
      });
      expect(isSubtype('nothing', collectionElementType(map.type.type)!)).toBe(
        false
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

describe('compiled Map declines a result type with a `nothing` arm', () => {
  // The call of the callback over one point is typed `any`. `any` has no
  // explicit `nothing` arm, so the map compiles (`hasNothingArm()`).
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
  )('a Nothing on a return path remains refused: %j', (body) => {
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
    // The `h` in the body of `Invoke` is its parameter, a function value
    // that this call does not lower. The compilation declines, and does not
    // call the global `h`.
    const result = compile(ce.box(['Map', 'Invoke', 'callbacks']));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not compile `h`/);
  });

  test.each(['(real) -> any', '(real) -> unknown', 'function'])(
    'an enclosing %s parameter does not read a global function of the same name',
    (type) => {
      const ce = new ComputeEngine();
      ce.assign('h', ce.box(['Function', 7, 'u']));
      const expr = ce.box([
        'Function',
        ['Map', 'h', ['List', 1, 2]],
        ['Typed', 'h', type],
      ]);
      const result = compile(expr);
      expect(result.success).toBe(true);
      const run = result.run! as unknown as (h: unknown) => unknown;
      expect(run((x: number) => x + 100)).toEqual([101, 102]);
      expect(
        ce
          .box(['Apply', expr, ['Function', ['Add', 'x', 100], 'x']])
          .evaluate()
          .toString()
      ).toBe('[101,102]');
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
    // The inner `h` has no declared type: the map reads the inner
    // parameter, not the outer one.
    const untyped = compile(build('h'));
    expect(untyped.success).toBe(true);
    const outer = untyped.run! as unknown as (h: unknown) => unknown;
    const inner = outer((x: number) => x + 1) as (h: unknown) => unknown;
    expect(inner((x: number) => x * 10)).toEqual([10, 20]);
    // A parameter declared with a function type declines in compiled code
    // (`docs/COMPILATION-MODEL.md`, "Function values").
    const typed = compile(build(['Typed', 'h', '(real) -> real']));
    expect(typed.success).toBe(false);
    expect(typed.error).toMatch(/declared with a function type/);
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
    // The parameter `h` is declared with a function type, which compiled
    // code does not compile (`docs/COMPILATION-MODEL.md`, "Function
    // values"): both programs decline before the callback is read.
    const shadowed = build(source);
    expect(shadowed.success).toBe(false);
    expect(shadowed.error).toMatch(/declared with a function type/);
    const captured = build(source.replace('for h in fs', 'for item in fs'));
    expect(captured.success).toBe(false);
    expect(captured.error).toMatch(/declared with a function type/);
  });

  test.each([false, true])(
    'a loop variable shadows a block-local function (mutable: %s)',
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
      // Inside the loop, `h` is the loop variable, not the local function.
      const shadowed = build(source);
      expect(shadowed.success).toBe(true);
      const runShadowed = shadowed.run!({}) as (fs: unknown[]) => unknown;
      expect(runShadowed([(x: number) => x * 10])).toEqual([[10, 20]]);
      const captured = build(source.replace('for h in fs', 'for item in fs'));
      // A local function that is assigned twice is a function value stored
      // in a local, which compiled code does not compile
      // (`docs/COMPILATION-MODEL.md`, "Function values").
      if (mutable) {
        expect(captured.success).toBe(false);
        expect(captured.error).toMatch(/assigned more than once/);
        return;
      }
      expect(captured.success).toBe(true);
      const run = captured.run!({}) as (fs: unknown[]) => unknown;
      expect(run([() => undefined])).toEqual([[2, 3]]);
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
    // The reassigned `h` is a function value stored in a local, which
    // compiled code does not compile (`docs/COMPILATION-MODEL.md`, "Function
    // values"), with or without a visible `Nothing`.
    const numeric = build(source.replace('Return(Nothing)', 'Return(9)'));
    expect(numeric.success).toBe(false);
    expect(numeric.error).toMatch(/assigned more than once/);
  });

  test('a numeric callback does not justify a source that can hold Nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<any>');
    expect(compile(ce.box(['Map', ['Function', 7, 'u'], 'xs'])).success).toBe(
      false
    );
  });

  test('an aggregate over an undeclared input compiles with the inferred numeric elements', () => {
    const ce = new ComputeEngine();
    // `x` is inferred `collection<number> | distribution | number` from the
    // parameter of `Mean`: its elements cannot be `Nothing`.
    const mean = compile(ce.box(['Mean', 'x']));
    expect(mean.success).toBe(true);
    expect(mean.run!({ x: [1, 3] })).toBe(2);
    ce.declare('ys', 'list<real>');
    expect(compile(ce.box(['Mean', 'ys'])).success).toBe(true);
  });
});
