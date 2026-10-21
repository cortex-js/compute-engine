// First-party Berlekamp kernel. Coefficients are ascending residues; the host
// supplies a prime <= 65521 and a monic square-free polynomial of degree <=128.
const input = new StaticArray<i32>(129);
const output = new StaticArray<i32>(16641);
let p: i32 = 2;
let remaining: i32 = 0;
let spent: i32 = 0;
let failure: i32 = 0;
export function inputPointer(): usize { return changetype<usize>(input); }
export function outputPointer(): usize { return changetype<usize>(output); }
export function operations(): i32 { return spent; }
export function errorCode(): i32 { return failure; }
function tick(n: i32 = 1): void {
  spent += n; remaining -= n;
  if (remaining < 0) { failure = 1; unreachable(); }
}
function mod(x: i64): i32 { const r = x % p; return <i32>(r < 0 ? r + p : r); }
function inv(x: i32): i32 {
  let a: i64 = p, b: i64 = x, u: i64 = 0, v: i64 = 1;
  while (b != 0) { const q = a / b; const r = a - q * b; a = b; b = r; const w = u - q * v; u = v; v = w; }
  if (a != 1) { failure = 2; unreachable(); }
  return mod(u);
}
function trim(a: i32[]): i32[] { while (a.length && a[a.length - 1] == 0) a.pop(); return a; }
function sub(a: i32[], b: i32[]): i32[] {
  const r = new Array<i32>(max(a.length, b.length));
  tick(r.length);
  for (let i = 0; i < r.length; i++) r[i] = mod(<i64>(i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0));
  return trim(r);
}
function mul(a: i32[], b: i32[]): i32[] {
  if (!a.length || !b.length) return [];
  const r = new Array<i32>(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) { tick(b.length); for (let j = 0; j < b.length; j++) r[i + j] = mod(<i64>r[i + j] + <i64>a[i] * b[j]); }
  return trim(r);
}
function rem(a: i32[], b: i32[]): i32[] {
  const r = a.slice();
  const inverse = inv(b[b.length - 1]);
  while (r.length >= b.length) {
    tick(b.length);
    const d = r.length - b.length, c = mod(<i64>r[r.length - 1] * inverse);
    for (let i = 0; i < b.length; i++) r[i + d] = mod(<i64>r[i + d] - <i64>c * b[i]);
    trim(r);
  }
  return r;
}
function quotient(a: i32[], b: i32[]): i32[] {
  const r = a.slice(), q = new Array<i32>(a.length - b.length + 1);
  const inverse = inv(b[b.length - 1]);
  while (r.length >= b.length) {
    tick(b.length);
    const d = r.length - b.length, c = mod(<i64>r[r.length - 1] * inverse); q[d] = c;
    for (let i = 0; i < b.length; i++) r[i + d] = mod(<i64>r[i + d] - <i64>c * b[i]);
    trim(r);
  }
  if (r.length) { failure = 2; unreachable(); }
  return trim(q);
}
function gcd(a: i32[], b: i32[]): i32[] {
  let x = a, y = b;
  while (y.length) { const r = rem(x, y); x = y; y = r; }
  if (!x.length) return [];
  const inverse = inv(x[x.length - 1]), r = new Array<i32>(x.length);
  for (let i = 0; i < x.length; i++) r[i] = mod(<i64>x[i] * inverse);
  return r;
}
function powmod(a: i32[], n: i32, f: i32[]): i32[] {
  let r: i32[] = [1], b = rem(a, f);
  while (n > 0) { if (n & 1) r = rem(mul(r, b), f); n >>= 1; if (n) b = rem(mul(b, b), f); }
  return r;
}
export function factor(degree: i32, prime: i32, budget: i32): i32 {
  spent = 0; failure = 0; remaining = budget; p = prime;
  if (degree < 1 || degree > 128 || prime < 2 || prime > 65521 || budget < 0) { failure = 2; unreachable(); }
  const f = new Array<i32>(degree + 1);
  for (let i = 0; i <= degree; i++) f[i] = input[i];
  const matrix = new Array<i32>(degree * degree);
  const xp = powmod([0, 1], p, f);
  let column: i32[] = [1];
  for (let j = 0; j < degree; j++) {
    for (let i = 0; i < degree; i++) matrix[i * degree + j] = mod(<i64>(i < column.length ? column[i] : 0) - (i == j ? 1 : 0));
    column = rem(mul(column, xp), f);
  }
  const pivots = new Array<i32>();
  for (let j = 0; j < degree; j++) {
    const r = pivots.length;
    let k = r; while (k < degree && matrix[k * degree + j] == 0) k++;
    if (k == degree) continue;
    for (let h = 0; h < degree; h++) { const v = matrix[r * degree + h]; matrix[r * degree + h] = matrix[k * degree + h]; matrix[k * degree + h] = v; }
    const inverse = inv(matrix[r * degree + j]);
    for (let h = 0; h < degree; h++) matrix[r * degree + h] = mod(<i64>matrix[r * degree + h] * inverse);
    for (let i = 0; i < degree; i++) {
      if (i == r || matrix[i * degree + j] == 0) continue;
      tick(degree); const c = matrix[i * degree + j];
      for (let h = 0; h < degree; h++) matrix[i * degree + h] = mod(<i64>matrix[i * degree + h] - <i64>c * matrix[r * degree + h]);
    }
    pivots.push(j);
  }
  const basis = new Array<i32[]>();
  for (let j = 0; j < degree; j++) {
    if (pivots.includes(j)) continue;
    const v = new Array<i32>(degree); v[j] = 1;
    for (let i = 0; i < pivots.length; i++) v[pivots[i]] = mod(-<i64>matrix[i * degree + j]);
    basis.push(trim(v));
  }
  let factors: i32[][] = [f];
  for (let b = 0; b < basis.length; b++) {
    for (let s = 0; s < p && factors.length < basis.length; s++) {
      const next = new Array<i32[]>();
      for (let i = 0; i < factors.length; i++) {
        const g = factors[i], d = gcd(g, sub(basis[b], [s]));
        if (d.length > 1 && d.length < g.length) { next.push(d); next.push(quotient(g, d)); } else next.push(g);
      }
      factors = next;
    }
  }
  if (factors.length != basis.length) { failure = 2; unreachable(); }
  let offset = 0;
  for (let i = 0; i < factors.length; i++) {
    const g = factors[i]; output[offset++] = g.length;
    for (let j = 0; j < g.length; j++) output[offset++] = g[j];
  }
  return factors.length;
}
