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

describe('Map applies its callback to a Nothing element', () => {
  test('count does not scan, and an indexed Nothing element gives the error of the callback', () => {
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
    // `UnusedCallback` is declared `(integer) -> integer`: the argument
    // `Nothing` is refused before its handler runs.
    expect(mapped.at(900000)?.operator).toBe('Error');
    expect([reads, calls]).toEqual([1, 0]);
  });

  test('an inline strict integer parameter gives an error for a Nothing element', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'Map((x: integer) => x * 2, Map(x => If(x == 2, Nothing, x), [1, 2, 3]))'
    );
    expect(result.diagnostics).toEqual([]);
    expect(
      [...result.value.each()].map((v) => v.operator === 'Error' ? 'Error' : v.re)
    ).toEqual([2, 'Error', 6]);
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
      // `DoublePresent` is declared `(integer) -> integer`: the argument
      // `Nothing` is refused before its handler runs. `DoublePresent` is
      // `pure: false`, so the view is impure, and a read by position of an
      // impure finite view makes one complete walk that the element memo
      // keeps (`docs/RANDOMNESS-MODEL.md` §6, CE-1125): the first read runs
      // the handler for the two present elements, 1 and 3, and never for
      // the element 2. Every later read is served from that walk.
      expect(mapped.at(2)?.operator).toBe('Error');
      expect(calls).toBe(2);
      expect(mapped.at(3)?.re).toBe(6);
      expect(calls).toBe(2);
      const before = calls;
      const values = [...mapped.each()];
      expect(
        values.map((v) => (v.operator === 'Error' ? 'Error' : v.re))
      ).toEqual([2, 'Error', 6]);
      expect(calls - before).toBe(0);
      expect(ce.function('ListFrom', [mapped]).evaluate().toString()).toBe(
        '[2,Error(ErrorCode("incompatible-type", "integer", "nothing"), "Nothing"),6]'
      );
      expect(inner.count).toBe(3);
      const element = collectionElementType(mapped.type.type)!;
      expect(isSubtype('nothing', element)).toBe(false);
      expectTypeBetween(mapped, { atMost: 'list<integer>' });
    }
  );

  test('a callback accepting any is called for a Nothing element', () => {
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
    expect([...mapped.each()].map((v) => v.symbol ?? v.re)).toEqual([9, 9, 9]);
    expect(calls).toBe(3);
  });

  test('fused and numeric maps give the error of the first level for a Nothing element', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const double = ce.box(['Function', ['Multiply', 'x', 2], 'x']);
    const shift = ce.box(['Function', ['Add', 'x', 1], 'x']);
    const mapped = ce
      .function('Map', [shift, ce.function('Map', [double, source(ce)])])
      .evaluate();
    const show = (v: Expression) =>
      v.operator === 'Error' ? 'Error' : v.re;
    expect(mapped.at(2)?.operator).toBe('Error');
    expect([...mapped.each()].map(show)).toEqual([3, 'Error', 7]);
    expect([...mapped.N().each()].map(show)).toEqual([3, 'Error', 7]);
  });

  test('zip mapping gives the error of the callback for a row with a Nothing input', () => {
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
    // `AddPresent` is `pure: false`: the read by position of the impure
    // finite view makes one complete walk that the element memo keeps
    // (`docs/RANDOMNESS-MODEL.md` §6, CE-1125). The walk runs the handler
    // for the rows 1 and 3 and never for the row with the `Nothing` input,
    // and the later iteration is served from that walk.
    expect(mapped.at(2)?.operator).toBe('Error');
    expect(calls).toBe(2);
    expect(
      [...mapped.each()].map((v) => (v.operator === 'Error' ? 'Error' : v.re))
    ).toEqual([11, 'Error', 33]);
    expect(calls).toBe(2);
    expectTypeBetween(mapped, { atMost: 'list<integer>' });
  });

  test('Missing is delivered to the callback', () => {
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
    'compilation refuses a source that can hold Nothing on %s',
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
