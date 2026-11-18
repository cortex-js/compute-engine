import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import { expectTypeBetween } from '../utils';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

describe('Map result-type inference preserves the remaining data contract', () => {
  // `xs` is typed from its declaration, not from the list it holds (a
  // static type does not depend on a value): over `any` the kind of the
  // result is not decided.
  test.each([
    ['any', 'collection'],
    ['list<any>', 'list'],
  ])(
    '%s retains nested collections and missing data',
    (type, kind) => {
      const ce = new ComputeEngine();
      ce.declare('xs', type);
      ce.assign('xs', ce.box(['List', ['List', 1, 'Missing'], ['List', 4]]));
      const map = ce.box(['Map', 'Sqrt', 'xs']);
      // `Sqrt(Missing)` is `Missing`, so the elements can be absent.
      expectTypeBetween(map, {
        atMost: `${kind}<indexed_collection<any> | missing | number>`,
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
    // call the global `h`: it does not compile a `Map` of a function that
    // is not a literal.
    const result = compile(ce.box(['Map', 'Invoke', 'callbacks']));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /Map of a function that is not a literal of one parameter/
    );
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
    // Both programs decline before the callback is read: the pipeline does
    // not compile a `DefineFunction`.
    const shadowed = build(source);
    expect(shadowed.success).toBe(false);
    expect(shadowed.diagnostic?.code).toBe('outside-profile');
    const captured = build(source.replace('for h in fs', 'for item in fs'));
    expect(captured.success).toBe(false);
    expect(captured.diagnostic?.code).toBe('outside-profile');
  });

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
    // `h` is a function value stored in a local, which compiled code does
    // not compile (`docs/COMPILATION-MODEL.md`, "Function values"), with or
    // without a visible `Nothing`.
    const omitted = build(source);
    expect(omitted.success).toBe(false);
    expect(omitted.error).toMatch(/a local of type \(real\) -> real/);
    const numeric = build(source.replace('Return(Nothing)', 'Return(9)'));
    expect(numeric.success).toBe(false);
    expect(numeric.error).toMatch(/a local of type \(real\) -> real/);
  });

  test('a numeric callback does not justify a source that can hold Nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<any>');
    expect(compile(ce.box(['Map', ['Function', 7, 'u'], 'xs'])).success).toBe(
      false
    );
  });
});
