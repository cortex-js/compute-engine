/**
 * Returns the smallest floating-point number greater than x.
 * Denormalized values may not be supported.
 */

export function nextUp(x: number): number {
  if (x !== x) return x;
  if (x === -1 / 0) return -Number.MAX_VALUE;
  if (x === 1 / 0) return +1 / 0;
  if (x === Number.MAX_VALUE) return +1 / 0;
  let y = x * (x < 0 ? 1 - Number.EPSILON / 2 : 1 + Number.EPSILON);
  if (y === x)
    y =
      Number.MIN_VALUE * Number.EPSILON > 0
        ? x + Number.MIN_VALUE * Number.EPSILON
        : x + Number.MIN_VALUE;
  if (y === +1 / 0) y = +Number.MAX_VALUE;
  const b = x + (y - x) / 2;
  if (x < b && b < y) y = b;
  const c = (y + x) / 2;
  if (x < c && c < y) y = c;
  return y === 0 ? -0 : y;
}

export function nextDown(x: number): number {
  return -nextUp(-x);
}
