import { ComputeEngine } from '../../src/compute-engine';

//
// A collection operator with its callback in the wrong position, in the
// body of a function literal whose parameter `xs` has no declared type,
// gives one result for the call, as the same call at the top level does: it
// is not applied to each element of the list bound to `xs`.
//
// A function literal maps over a list argument when its parameters are
// scalar by its signature, and a parameter with no type from its uses
// (`unknown`) counts as scalar. In `xs ↦ ArgMax(f, xs)`, the optimization
// form of `ArgMax` (`ArgMax(f, domain)`) gave `xs` no type, so
// `Apply(xs ↦ 1 + ArgMax(f, xs), [1, 4])` was a list of two errors, one per
// element, where `1 + ArgMax(f, [1, 4])` is one error. The domain of the
// optimization form is a collection (a set), so `xs` is now typed
// `collection`.
//

const F = ['Function', ['Multiply', 2, 'x'], 'x'];
const R = ['Function', ['Add', 'a', 'x'], 'a', 'x'];

let failedAssertions: string[] = [];
const originalAssert = console.assert;
beforeEach(() => {
  failedAssertions = [];
  console.assert = (condition?: boolean, ...data: unknown[]) => {
    if (!condition) failedAssertions.push(data.map(String).join(' '));
  };
});
afterEach(() => {
  console.assert = originalAssert;
});

const errorOf = (json: unknown): unknown =>
  Array.isArray(json) && json[0] === 'Error' ? json[1] : undefined;

function applyBody(ce: ComputeEngine, body: unknown, arg: unknown) {
  return ce.box([
    'Apply',
    ['Function', body, 'xs'],
    arg,
  ] as Parameters<typeof ce.box>[0]);
}

describe('A CALLBACK IN THE WRONG POSITION IN THE BODY OF A FUNCTION', () => {
  for (const op of ['ArgMax', 'ArgMin']) {
    test(`\`Apply(xs ↦ 1 + ${op}(f, xs), [1, 4])\` is the error of \`1 + ${op}(f, [1, 4])\``, () => {
      const ce = new ComputeEngine();
      const top = ce.box(['Add', 1, [op, F, ['List', 1, 4]]] as any).evaluate();
      const inBody = applyBody(ce, ['Add', 1, [op, F, 'xs']], [
        'List',
        1,
        4,
      ]).evaluate();
      expect(failedAssertions).toEqual([]);
      expect(errorOf(inBody.json)).toEqual([
        'ErrorCode',
        "'incompatible-type'",
        "'indexed_collection'",
        "'(x: unknown) -> number'",
      ]);
      expect(errorOf(inBody.json)).toEqual(errorOf(top.json));
    });
  }

  test('the parameter at the domain of the optimization form is a collection', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 1, ['ArgMax', F, 'xs']], 'xs']);
    expect(f.type.toString()).toBe('(xs: collection) -> integer');
  });

  test('a set bound to the parameter keeps the optimization form, inert', () => {
    const ce = new ComputeEngine();
    const v = applyBody(ce, ['ArgMax', F, 'xs'], ['Set', 1, 4]).evaluate();
    expect(failedAssertions).toEqual([]);
    expect(v.toString()).toBe('ArgMax((x) => 2x, Set(1, 4))');
    const r = applyBody(ce, ['ArgMin', F, 'xs'], 'RealNumbers').evaluate();
    expect(r.toString()).toBe('ArgMin((x) => 2x, "RealNumbers")');
  });

  test('a parameter inferred as a number before the call keeps the collection form', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', ['Multiply', 2, 'xs'], ['ArgMax', F, 'xs']],
      'xs',
    ]);
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(
      /ArgMax\(Error\(ErrorCode\("incompatible-type", "indexed_collection"/
    );
  });

  test('a global inferred as a number by `2n` is not a domain: `ArgMax(f, n)`', () => {
    const ce = new ComputeEngine();
    ce.box(['Multiply', 2, 'n']);
    const e = ce.box(['ArgMax', F, 'n']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toMatch(/^ArgMax\(Error\(ErrorCode\("incompatible-type", "indexed_collection"/);
  });

  test('a global domain keeps its type: `S`, then `ArgMax(f, S)`', () => {
    const ce = new ComputeEngine();
    ce.box('S');
    const e = ce.box(['ArgMax', F, 'S']);
    expect(e.isValid).toBe(true);
    expect(ce.box('S').type.toString()).toBe('unknown');
  });

  // A local of a `Block` is not narrowed: it can be assigned a list later
  // in the block, and the call then gives the collection-form error.

  test('an undeclared domain at the top level is still not declared', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['ArgMax', F, 'T']);
    expect(e.isValid).toBe(true);
    expect(ce.lookupDefinition('T')).toBeUndefined();
  });

  test('a symbol declared `unknown` and assigned a list is refused at evaluation', () => {
    const ce = new ComputeEngine();
    ce.declare('ys', 'unknown');
    const e = ce.box(['Add', 1, ['ArgMax', F, 'ys']]);
    ce.assign('ys', ce.box(['List', 1, 4]));
    const v = e.evaluate();
    expect(failedAssertions).toEqual([]);
    expect((errorOf(v.json) as unknown[])[2]).toBe("'indexed_collection'");
  });

  // A callback-first operator with its callback last: the function at the
  // collection position is refused when the body is canonicalized, so the
  // call gives one error, not one per element.
  test('`Apply(xs ↦ 1 + Map(xs, x ↦ 2x), [1, 4])` is one error', () => {
    const ce = new ComputeEngine();
    const v = applyBody(ce, ['Add', 1, ['Map', 'xs', F]], [
      'List',
      1,
      4,
    ]).evaluate();
    expect(failedAssertions).toEqual([]);
    expect(errorOf(v.json)).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'collection'",
      "'(x: unknown) -> number'",
    ]);
    // The same call at the top level, over an undeclared symbol.
    const top = ce.box(['Add', 1, ['Map', 't', F]]).evaluate();
    expect(errorOf(top.json)).toEqual(errorOf(v.json));
  });

  test('`Apply(xs ↦ 1 + Fold(xs, 0, f), [1, 4])` is one error', () => {
    const ce = new ComputeEngine();
    const v = applyBody(ce, ['Add', 1, ['Fold', 'xs', 0, R]], [
      'List',
      1,
      4,
    ]).evaluate();
    expect(failedAssertions).toEqual([]);
    expect((errorOf(v.json) as unknown[])[2]).toBe("'collection'");
  });

  for (const method of ['N', 'simplify'] as const) {
    test(`\`${method}()\` of the misordered calls fires no assertion`, () => {
      const ce = new ComputeEngine();
      for (const call of [
        ['ArgMax', F, 'xs'],
        ['Map', 'xs', F],
        ['Filter', ['Function', ['Greater', 'x', 0], 'x'], 'xs'],
      ]) {
        const v = applyBody(ce, ['Add', 1, call], ['List', 1, 4])[method]();
        expect(v.json).toBeDefined();
      }
      expect(failedAssertions).toEqual([]);
    });
  }
});
