import type { V } from './ir.js';

/** Finite bounds are seeded by the effective input declarations. Propagate
 *  them only through rounding and power-of-two scaling, with shader
 *  precision at each step. */
export function shaderBounds(
  constant: (v: V) => number | undefined,
  definition: (v: V) => { op: string; args: readonly V[] } | undefined,
  inputs?: ReadonlyMap<V, readonly [number, number]>
): (v: V) => readonly [number, number] | undefined {
  const boundsOf = (
    v: V,
    depth = 0
  ): readonly [number, number] | undefined => {
    const c = constant(v);
    if (c !== undefined) return [Math.fround(c), Math.fround(c)];
    const input = inputs?.get(v);
    if (input !== undefined || depth >= 4) return input;
    const d = definition(v);
    if (d === undefined) return undefined;
    if (d.op === 'ceil' || d.op === 'floor') {
      const bounds = boundsOf(d.args[0], depth + 1);
      if (bounds === undefined) return undefined;
      const round = d.op === 'ceil' ? Math.ceil : Math.floor;
      return [round(bounds[0]), round(bounds[1])];
    }
    if (d.op !== 'mul' && d.op !== 'mul.int') return undefined;
    const [x, y] = d.args;
    const left = constant(x);
    const scale = left ?? constant(y);
    if (scale === undefined) return undefined;
    const power = Math.log2(Math.abs(scale));
    if (!Number.isInteger(power) || scale !== Math.fround(scale) || power < -126)
      return undefined;
    const bounds = boundsOf(left !== undefined ? y : x, depth + 1);
    if (bounds === undefined) return undefined;
    const a = Math.fround(bounds[0] * scale);
    const z = Math.fround(bounds[1] * scale);
    const lo = Math.min(a, z);
    const hi = Math.max(a, z);
    // A shader can flush a subnormal product to zero.
    return [lo > 0 && lo < 2 ** -126 ? 0 : lo, hi < 0 && hi > -(2 ** -126) ? 0 : hi];
  };
  return boundsOf;
}
