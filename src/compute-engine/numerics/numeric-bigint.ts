export function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}
