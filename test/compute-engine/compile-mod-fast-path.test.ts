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
});
