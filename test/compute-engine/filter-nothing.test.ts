import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { expectTypeBetween } from '../utils';

function rawSource(ce: ComputeEngine): Expression {
  return ce.box([
    'Map',
    ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
    ['List', 1, 2, 3],
  ]);
}

function fixture() {
  const ce = new ComputeEngine();
  const seen: Expression[] = [];
  ce.declare('Keep', {
    signature: '(integer) -> boolean',
    pure: false,
    evaluate: ([x]) => {
      seen.push(x);
      return ce.True;
    },
  });
  const source = rawSource(ce);
  return {
    ce,
    seen,
    source,
    filtered: ce.function('Filter', [source, ce.symbol('Keep')]),
  };
}

describe('Filter drops immediate Nothing without calling its predicate', () => {
  test('one traversal drops omissions and invokes a strict predicate only for data', () => {
    const { filtered, source, seen } = fixture();
    expect(filtered.isValid).toBe(true);
    expect([...filtered.each()].map((v) => v.re)).toEqual([1, 3]);
    expect(seen.map((v) => v.re)).toEqual([1, 3]);
    expect(source.count).toBe(3);
    expectTypeBetween(filtered, { atMost: 'list<integer>' });
    expect(
      isSubtype('nothing', collectionElementType(filtered.type.type)!)
    ).toBe(false);
  });

  test.each(['box', 'function', 'parse'] as const)(
    '%s route drops omitted inputs',
    (route) => {
      const ce = new ComputeEngine();
      const predicate = ['Function', 'True', ['Typed', 'x', "'integer'"]];
      const filtered =
        route === 'box'
          ? ce.box(['Filter', rawSource(ce), predicate])
          : route === 'function'
            ? ce.function('Filter', [rawSource(ce), ce.box(predicate)])
            : ce.parse(
                '\\mathrm{Filter}(\\mathrm{Map}(x \\mapsto \\mathrm{If}(x=2, \\mathrm{Nothing}, x), [1,2,3]), x \\mapsto \\mathrm{True})'
              );
      expect(filtered.isValid).toBe(true);
      expect([...filtered.evaluate().each()].map((v) => v.re)).toEqual([1, 3]);
    }
  );

  test('Epsil accepts an explicitly numeric predicate over an omission-producing view', () => {
    const result = executeEpsil(
      new ComputeEngine(),
      'Filter(Map(x => If(x == 2, Nothing, x), [1, 2, 3]), (x: integer) => True)'
    );
    expect(result.diagnostics).toEqual([]);
    expect([...result.value.each()].map((v) => v.re)).toEqual([1, 3]);
  });

  test('count consumes each participating datum once', () => {
    const { filtered, seen } = fixture();
    expect(filtered.count).toBe(2);
    expect(seen.map((v) => v.re)).toEqual([1, 3]);
  });

  test('Count(source, predicate) agrees with counting Filter and bypasses omissions', () => {
    const first = fixture();
    const direct = first.ce
      .function('Count', [first.source, first.ce.symbol('Keep')])
      .evaluate();
    expect(direct.re).toBe(2);
    expect(first.seen.map((v) => v.re)).toEqual([1, 3]);
    const second = fixture();
    expect(second.ce.function('Count', [second.filtered]).evaluate().re).toBe(
      2
    );
    expect(second.seen.map((v) => v.re)).toEqual([1, 3]);
  });

  test('compiled predicate Count refuses omission-capable sources', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing>');
    const result = compile(ce.box(['Count', 'xs', ['Function', 'True', 'x']]));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });

  test('positive indexing scans only through the requested survivor', () => {
    const { filtered, seen } = fixture();
    expect(filtered.at(2)?.re).toBe(3);
    expect(seen.map((v) => v.re)).toEqual([1, 3]);
  });

  test('negative indexing uses the filtered positions', () => {
    const { filtered, seen } = fixture();
    expect(filtered.at(-1)?.re).toBe(3);
    expect(seen.map((v) => v.re)).toEqual([1, 3]);
  });

  test('Nothing is not a member and membership does not invoke the predicate', () => {
    const { ce, filtered, seen } = fixture();
    expect(filtered.contains(ce.Nothing)).toBe(false);
    expect(seen).toEqual([]);
    expect(filtered.contains(ce.number(3))).toBe(true);
    expect(seen.map((v) => v.re)).toEqual([3]);
  });

  test('an all-omitted finite source is empty, with no predicate calls', () => {
    const { ce, seen } = fixture();
    const source = ce.box([
      'Map',
      ['Function', 'Nothing', 'x'],
      ['Range', 1, 3],
    ]);
    const filtered = ce.function('Filter', [source, ce.symbol('Keep')]);
    expect([...filtered.each()]).toEqual([]);
    expect(filtered.isEmptyCollection).toBe(true);
    expect(filtered.count).toBe(0);
    expect(seen).toEqual([]);
  });

  test('omitted pulls still enforce the iteration limit', () => {
    const { ce, seen } = fixture();
    ce.iterationLimit = 4;
    const source = ce.box([
      'Map',
      ['Function', 'Nothing', 'x'],
      ['Range', 1, 'PositiveInfinity'],
    ]);
    const filtered = ce.function('Filter', [source, ce.symbol('Keep')]);
    expect(() => filtered.each().next()).toThrow(/Iteration limit/);
    expect(seen).toEqual([]);
  });

  test('Missing still reaches a predicate accepting any', () => {
    const ce = new ComputeEngine();
    const seen: string[] = [];
    ce.declare('KeepAny', {
      signature: '(any) -> boolean',
      pure: false,
      evaluate: ([x]) => {
        seen.push(x.symbol ?? String(x.re));
        return ce.True;
      },
    });
    const filtered = ce.box(['Filter', ['List', 1, 'Missing'], 'KeepAny']);
    expect([...filtered.each()].map((v) => v.symbol ?? v.re)).toEqual([
      1,
      'Missing',
    ]);
    expect(seen).toEqual(['1', 'Missing']);
  });

  test('a datum containing Nothing is not bypassed', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Datum', {
      signature: '(integer) -> tuple<integer, nothing>',
      evaluate: ([x]) => ce._fn('Tuple', [x, ce.Nothing]),
    });
    ce.declare('Visit', {
      signature: '(any) -> boolean',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.True;
      },
    });
    const filtered = ce.box([
      'Filter',
      ['Map', 'Datum', ['Range', 1, 2]],
      'Visit',
    ]);
    expect([...filtered.each()]).toHaveLength(2);
    expect(calls).toBe(2);
  });

  test.each(['list<integer | nothing>', 'set<integer | nothing>'])(
    'result type removes only immediate omission from %s',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('xs', type);
      const result = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
      expect(
        isSubtype('nothing', collectionElementType(result.type.type)!)
      ).toBe(false);
      expect(
        isSubtype('integer', collectionElementType(result.type.type)!)
      ).toBe(true);
    }
  );

  test('nested omission remains in the result element type', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<integer | nothing, integer>>');
    const result = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
    expectTypeBetween(result, {
      atMost: 'list<tuple<integer | nothing, integer>>',
    });
  });

  test.each(['javascript', 'python'] as const)(
    '%s refuses possible omissions',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<integer | nothing>');
      const filter = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
      for (const expr of [filter, ce.box(['Sum', filter])]) {
        const compiled = compile(expr, { to });
        expect(compiled.success).toBe(false);
        if (expr === filter || to === 'javascript')
          expect(compiled.error).toMatch(/Nothing/);
      }
    }
  );

  test.each(['javascript', 'python'] as const)(
    '%s checks every collection alternative for possible omissions',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<integer | nothing> | tuple<integer, integer>');
      const filtered = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
      expect(filtered.isValid).toBe(true);
      const result = compile(filtered, { to });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
    }
  );

  test('bounded infinite pipelines refuse omission-capable stream stages', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer | nothing');
    ce.declare('n', 'integer');
    const mapped = ce.box(['Map', 'f', ['Range', 1, 'PositiveInfinity']]);
    const filtered = ce.box(['Filter', mapped, ['Function', 'True', 'x']]);
    for (const source of [mapped, filtered]) {
      const result = compile(ce.box(['Take', source, 'n']));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
    }
  });

  test('ordinary numeric filters still compile', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
    const result = compile(
      ce.box(['Filter', 'xs', ['Function', ['Greater', 'x', 1], 'x']])
    );
    expect(result.success).toBe(true);
    expect(result.run!({ xs: [1, 2, 3] })).toEqual([2, 3]);
  });
});
