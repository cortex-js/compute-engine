import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The JavaScript `Mod` lowering emits a plain `%` when both operands are
// integers from `0` to `2^53 - 1` that cannot be beyond that range: a number
// literal, or a symbol whose static type is a bounded integer range inside
// it. Every other pair calls `_SYS.floorMod`, which checks at run time that
// each operand is inside the safe integer range. An operand typed bare
// `integer` has no bound and must keep the checked helper.

const ce = new ComputeEngine();
ce.declare('i', 'integer<0..100>');
ce.declare('k', 'integer');
ce.declare('big', `integer<0..${2 ** 53}>`);
ce.declare('s', 'integer<-5..5>');

function compiled(json: unknown) {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return r;
}

describe('compiled Mod: plain % for operands bounded inside the safe range', () => {
  it('a dividend typed integer<0..100> and a literal divisor use %', () => {
    const r = compiled(['Mod', 'i', 2]);
    expect(r.code).toContain('%');
    expect(r.code).not.toContain('_SYS.floorMod');
    for (let i = 0; i <= 100; i += 7) {
      const expected = ce.box(['Mod', i, 2]).evaluate().re;
      expect(r.run!({ i } as never)).toBe(expected);
    }
  });

  it('two bounded symbols use %', () => {
    ce.declare('d', 'integer<1..10>');
    const r = compiled(['Mod', 'i', 'd']);
    expect(r.code).not.toContain('_SYS.floorMod');
    for (const [i, d] of [
      [0, 1],
      [17, 5],
      [100, 7],
      [99, 10],
    ]) {
      const expected = ce.box(['Mod', i, d]).evaluate().re;
      expect(r.run!({ i, d } as never)).toBe(expected);
    }
  });

  it('a dividend typed bare integer keeps the checked helper', () => {
    expect(compiled(['Mod', 'k', 2]).code).toContain('_SYS.floorMod(');
  });

  it('a divisor typed bare integer keeps the checked helper', () => {
    expect(compiled(['Mod', 'i', 'k']).code).toContain('_SYS.floorMod(');
  });

  it('a range whose upper bound is beyond 2^53 - 1 keeps the checked helper', () => {
    expect(compiled(['Mod', 'big', 3]).code).toContain('_SYS.floorMod(');
  });

  it('a range that admits negative values keeps the floored helper', () => {
    const r = compiled(['Mod', 's', 3]);
    expect(r.code).toContain('_SYS.floorMod(');
    for (let s = -5; s <= 5; s++) {
      const expected = ce.box(['Mod', s, 3]).evaluate().re;
      expect(r.run!({ s } as never)).toBe(expected);
    }
  });

  it('the index of a Sum over literal limits uses %', () => {
    // The index of `Limits(j, 1, 1000)` is typed `integer<1..1000>`. The
    // range is large enough that the emitter builds a counted loop instead
    // of unrolling it.
    const json = [
      'Sum',
      ['Multiply', 'x', ['Mod', 'j', 3]],
      ['Limits', 'j', 1, 1000],
    ];
    const r = compiled(json);
    expect(r.code).toContain('((j) % (3))');
    expect(r.code).not.toContain('_SYS.floorMod');
    const expected = ce
      .box(json as never)
      .subs({ x: 2 })
      .evaluate().re;
    expect(r.run!({ x: 2 } as never)).toBe(expected);
  });

  it('the index of a Loop over a Range with literal bounds uses %', () => {
    // The index of `Element(j, Range(1, 100))` is typed `integer<1..100>`,
    // as the index of a `Sum` over `Limits(j, 1, 100)` is.
    const json = [
      'Block',
      ['Declare', 'c', "'integer'"],
      ['Assign', 'c', 0],
      [
        'Loop',
        [
          'If',
          ['Equal', ['Mod', 'j', 3], 0],
          ['Assign', 'c', ['Add', 'c', 1]],
          'Nothing',
        ],
        ['Element', 'j', ['Range', 1, 100]],
      ],
      'c',
    ];
    const r = compiled(json);
    expect(r.code).toContain('((j) % (3))');
    expect(r.code).not.toContain('_SYS.floorMod');
    expect(r.run!({} as never)).toBe(33);
  });

  it('the index of a Loop over a Range with a symbolic bound keeps the checked helper', () => {
    // `k` is typed bare `integer`, so the index has no bound. The loop reads
    // `k` at run time: before, the counted-loop lowering read both bounds at
    // compile time and failed with "bounds must be finite numbers".
    const json = [
      'Block',
      ['Declare', 'c', "'integer'"],
      ['Assign', 'c', 0],
      [
        'Loop',
        [
          'If',
          ['Equal', ['Mod', 'j', 3], 0],
          ['Assign', 'c', ['Add', 'c', 1]],
          'Nothing',
        ],
        ['Element', 'j', ['Range', 1, 'k']],
      ],
      'c',
    ];
    const r = compiled(json);
    expect(r.code).toContain('_SYS.floorMod(');
    expect(r.run!({ k: 100 } as never)).toBe(33);
    expect(r.run!({ k: 10 } as never)).toBe(3);
  });
});
