import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import { expectTypeBetween } from '../utils';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function source(ce: ComputeEngine): Expression {
  return ce
    .box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
      ['List', 1, 2, 3],
    ])
    .evaluate();
}

describe('Map skips callbacks for Nothing while retaining positions', () => {
  test('count and distant indexing do not scan or invoke bypassed callbacks', () => {
    const ce = new ComputeEngine();
    let reads = 0;
    let calls = 0;
    ce.declare('OmittedInput', {
      signature: '(integer) -> nothing',
      pure: false,
      evaluate: () => {
        reads++;
        return ce.Nothing;
      },
    });
    ce.declare('UnusedCallback', {
      signature: '(integer) -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(9);
      },
    });
    const mapped = ce
      .box([
        'Map',
        'UnusedCallback',
        ['Map', 'OmittedInput', ['Range', 1, 1000000]],
      ])
      .evaluate();
    expect(mapped.isValid).toBe(true);
    expect(mapped.count).toBe(1000000);
    expect([reads, calls]).toEqual([0, 0]);
    expect(mapped.at(900000)?.symbol).toBe('Nothing');
    expect([reads, calls]).toEqual([1, 0]);
  });

  test('an inline strict integer parameter accepts a source with Nothing', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'Map((x: integer) => x * 2, Map(x => If(x == 2, Nothing, x), [1, 2, 3]))'
    );
    expect(result.diagnostics).toEqual([]);
    expect([...result.value.each()].map((v) => v.symbol ?? v.re)).toEqual([
      2,
      'Nothing',
      6,
    ]);
  });

  test('a named producer retains inferred Nothing in its mapped result', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'omitter',
      ce.box(['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'])
    );
    const mapped = ce.box(['Map', 'omitter', ['List', 1, 2, 3]]).evaluate();
    expect(isSubtype('nothing', collectionElementType(mapped.type.type)!)).toBe(
      true
    );
  });

  test('an early return inside a conditional retains Nothing in the result type', () => {
    const ce = new ComputeEngine();
    const mapped = ce
      .box([
        'Map',
        [
          'Function',
          ['Block', ['If', ['Equal', 'x', 2], ['Return', 'Nothing']], 'x'],
          'x',
        ],
        ['List', 1, 2, 3],
      ])
      .evaluate();
    expect([...mapped.each()].map((v) => v.symbol ?? v.re)).toEqual([
      1,
      'Nothing',
      3,
    ]);
    expect(isSubtype('nothing', collectionElementType(mapped.type.type)!)).toBe(
      true
    );
  });

  test('a nested Nothing coordinate is delivered as part of its datum', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('NestedDatum', {
      signature: '(integer) -> tuple<integer, nothing>',
      evaluate: ([x]) => ce._fn('Tuple', [x, ce.Nothing]),
    });
    ce.declare('VisitNested', {
      signature: '(any) -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(7);
      },
    });
    const nested = ce.box(['Map', 'NestedDatum', ['Range', 1, 2]]).evaluate();
    const mapped = ce
      .function('Map', [ce.symbol('VisitNested'), nested])
      .evaluate();
    expect([...mapped.each()].map((v) => v.re)).toEqual([7, 7]);
    expect(calls).toBe(2);
  });

  test.each(['auto', 'off'] as const)(
    'index, iteration and materialization with jit=%s',
    (jit) => {
      const ce = new ComputeEngine();
      ce.jit = jit;
      let calls = 0;
      ce.declare('DoublePresent', {
        signature: '(integer) -> integer',
        pure: false,
        evaluate: ([x]) => {
          calls++;
          return ce.number(x.re * 2);
        },
      });
      const inner = source(ce);
      const mapped = ce
        .function('Map', [ce.symbol('DoublePresent'), inner])
        .evaluate();
      expect(mapped.isValid).toBe(true);
      expect(mapped.count).toBe(3);
      expect(calls).toBe(0);
      expect(mapped.at(2)?.symbol).toBe('Nothing');
      expect(calls).toBe(0);
      expect(mapped.at(3)?.re).toBe(6);
      expect(calls).toBe(1);
      const before = calls;
      const values = [...mapped.each()];
      expect(values.map((v) => v.symbol ?? v.re)).toEqual([2, 'Nothing', 6]);
      expect(calls - before).toBe(2);
      expect(ce.function('ListFrom', [mapped]).evaluate().toString()).toBe(
        '[2,6]'
      );
      expect(inner.count).toBe(3);
      const element = collectionElementType(mapped.type.type)!;
      expect(isSubtype('nothing', element)).toBe(true);
      expectTypeBetween(mapped, {
        atMost: 'list<integer | nothing>',
        above: 'list<integer>',
      });
    }
  );

  test('a callback accepting Nothing still cannot replace a bypassed element', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('ReplaceAnything', {
      signature: '(any) -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(9);
      },
    });
    const mapped = ce
      .function('Map', [ce.symbol('ReplaceAnything'), source(ce)])
      .evaluate();
    expect([...mapped.each()].map((v) => v.symbol ?? v.re)).toEqual([
      9,
      'Nothing',
      9,
    ]);
    expect(calls).toBe(2);
  });

  test('fused and numeric maps preserve bypass at every level', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const double = ce.box(['Function', ['Multiply', 'x', 2], 'x']);
    const shift = ce.box(['Function', ['Add', 'x', 1], 'x']);
    const mapped = ce
      .function('Map', [shift, ce.function('Map', [double, source(ce)])])
      .evaluate();
    expect(mapped.at(2)?.symbol).toBe('Nothing');
    expect([...mapped.each()].map((v) => v.symbol ?? v.re)).toEqual([
      3,
      'Nothing',
      7,
    ]);
    expect([...mapped.N().each()].map((v) => v.symbol ?? v.re)).toEqual([
      3,
      'Nothing',
      7,
    ]);
  });

  test('zip mapping bypasses a row if any immediate input is Nothing', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('AddPresent', {
      signature: '(integer, integer) -> integer',
      pure: false,
      evaluate: ([x, y]) => {
        calls++;
        return ce.number(x.re + y.re);
      },
    });
    const mapped = ce
      .function('Map', [
        ce.symbol('AddPresent'),
        source(ce),
        ce.box(['List', 10, 20, 30]),
      ])
      .evaluate();
    expect(mapped.at(2)?.symbol).toBe('Nothing');
    expect(calls).toBe(0);
    expect([...mapped.each()].map((v) => v.symbol ?? v.re)).toEqual([
      11,
      'Nothing',
      33,
    ]);
    expect(calls).toBe(2);
    expectTypeBetween(mapped, {
      atMost: 'list<integer | nothing>',
      above: 'list<integer>',
    });
  });

  test('Missing is delivered, and Nothing nested in a datum does not bypass it', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Visit', {
      signature: '(any) -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(1);
      },
    });
    const input = ce
      .box([
        'Map',
        [
          'Function',
          ['If', ['Equal', 'x', 2], 'Missing', ['Tuple', 'x', 'Missing']],
          'x',
        ],
        ['List', 1, 2, 3],
      ])
      .evaluate();
    const mapped = ce.function('Map', [ce.symbol('Visit'), input]).evaluate();
    expect([...mapped.each()].map((v) => v.re)).toEqual([1, 1, 1]);
    expect(calls).toBe(3);
  });

  test.each(['javascript', 'python'] as const)(
    'compilation refuses raw omissions on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<integer | nothing>');
      const mapped = ce.box([
        'Map',
        ['Function', ['Multiply', 'x', 2], 'x'],
        'xs',
      ]);
      const result = compile(mapped, { to });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
    }
  );

  test('ordinary compiled maps still run', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
    const compiled = compile(
      ce.box(['Map', ['Function', ['Multiply', 'x', 2], 'x'], 'xs'])
    );
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ xs: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});
