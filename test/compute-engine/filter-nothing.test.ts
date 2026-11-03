import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
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
      return x.re === 2 ? ce.False : ce.True;
    },
  });
  const source = ce.box(['Map', ['Function', 'x', 'x'], ['List', 1, 2, 3]]);
  return {
    ce,
    seen,
    source,
    filtered: ce.function('Filter', [source, ce.symbol('Keep')]),
  };
}

describe('Filter and Nothing', () => {
  test('one traversal invokes the predicate once for each datum', () => {
    const { filtered, source, seen } = fixture();
    expect(filtered.isValid).toBe(true);
    expect([...filtered.each()].map((v) => v.re)).toEqual([1, 3]);
    expect(seen.map((v) => v.re)).toEqual([1, 2, 3]);
    expect(source.count).toBe(3);
    expectTypeBetween(filtered, { atMost: 'list<integer>' });
  });

  test.each(['box', 'function', 'parse'] as const)(
    '%s route keeps a Nothing element',
    (route) => {
      const ce = new ComputeEngine();
      const predicate = ['Function', 'True', 'x'];
      const filtered =
        route === 'box'
          ? ce.box(['Filter', rawSource(ce), predicate])
          : route === 'function'
            ? ce.function('Filter', [rawSource(ce), ce.box(predicate)])
            : ce.parse(
                '\\mathrm{Filter}(\\mathrm{Map}(x \\mapsto \\mathrm{If}(x=2, \\mathrm{Nothing}, x), [1,2,3]), x \\mapsto \\mathrm{True})'
              );
      expect(filtered.isValid).toBe(true);
      expect([...filtered.evaluate().each()].map((v) => v.json)).toEqual([
        1,
        'Nothing',
        3,
      ]);
    }
  );

  test('count consumes each datum once', () => {
    const { filtered, seen } = fixture();
    expect(filtered.count).toBe(2);
    expect(seen.map((v) => v.re)).toEqual([1, 2, 3]);
  });

  test('Count(source, predicate) agrees with counting Filter', () => {
    const first = fixture();
    const direct = first.ce
      .function('Count', [first.source, first.ce.symbol('Keep')])
      .evaluate();
    expect(direct.re).toBe(2);
    expect(first.seen.map((v) => v.re)).toEqual([1, 2, 3]);
    const second = fixture();
    expect(second.ce.function('Count', [second.filtered]).evaluate().re).toBe(
      2
    );
    expect(second.seen.map((v) => v.re)).toEqual([1, 2, 3]);
  });

  test('compiled predicate Count refuses sources that can hold Nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing>');
    const result = compile(ce.box(['Count', 'xs', ['Function', 'True', 'x']]));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });

  test('positive indexing scans only through the requested survivor', () => {
    const { filtered, seen } = fixture();
    expect(filtered.at(2)?.re).toBe(3);
    expect(seen.map((v) => v.re)).toEqual([1, 2, 3]);
  });

  test('negative indexing uses the filtered positions', () => {
    const { filtered } = fixture();
    expect(filtered.at(-1)?.re).toBe(3);
    expect(filtered.at(-2)?.re).toBe(1);
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
    'result type keeps the nothing arm of %s',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('xs', type);
      const result = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
      expect(
        isSubtype('nothing', collectionElementType(result.type.type)!)
      ).toBe(true);
      expect(
        isSubtype('integer', collectionElementType(result.type.type)!)
      ).toBe(true);
    }
  );

  test('a nested Nothing remains in the result element type', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<integer | nothing, integer>>');
    const result = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
    expectTypeBetween(result, {
      atMost: 'list<tuple<integer | nothing, integer>>',
    });
  });

  test.each(['javascript', 'python'] as const)(
    '%s refuses a source that can hold Nothing',
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
    '%s checks every collection alternative for a possible Nothing',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<integer | nothing> | list<list<integer>>');
      const filtered = ce.box(['Filter', 'xs', ['Function', 'True', 'x']]);
      expect(filtered.isValid).toBe(true);
      const result = compile(filtered, { to });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
      // A list and a number are told apart at run time, so the compilation
      // of the list member reads its possible `Nothing` elements.
      ce.declare('zs', 'list<integer | nothing> | integer');
      const scalarOrList = compile(
        ce.box(['Filter', 'zs', ['Function', 'True', 'x']]),
        { to }
      );
      expect(scalarOrList.success).toBe(false);
      expect(scalarOrList.error).toMatch(/Nothing/);
      // A union of a list and a tuple of two numbers declines before: the
      // compiled code holds both as an array, and cannot tell a list of
      // two numbers from the tuple at run time.
      ce.declare('ys', 'list<integer | nothing> | tuple<integer, integer>');
      const union = compile(
        ce.box(['Filter', 'ys', ['Function', 'True', 'x']]),
        { to }
      );
      expect(union.success).toBe(false);
      expect(union.error).toMatch(/cannot tell apart/);
    }
  );

  test('bounded infinite pipelines refuse stream stages that can give Nothing', () => {
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
