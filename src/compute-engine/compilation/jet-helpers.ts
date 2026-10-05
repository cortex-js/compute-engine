// The run-time half of forward-mode differentiation: the jet arithmetic that
// `_SYS` carries (`jet-derivative.ts` emits calls to it). It imports no engine
// code, so that the runtime entry point can include it without the engine.

/** A jet of `n + 1` zero coefficients. */
function zeroJet(n: number): number[] {
  return new Array<number>(n + 1).fill(0);
}

/**
 * A host value entering jet arithmetic. The lowering is real-lane only, so a
 * complex `{re, im}` or a collection reaching a coefficient slot is a value
 * this arithmetic cannot represent: it becomes NaN and propagates, rather
 * than silently producing a number from an object.
 */
function asReal(x: unknown): number {
  return typeof x === 'number' ? x : NaN;
}

/**
 * The coefficients of `a^r` above the constant one, from the ODE
 * `a·w′ = r·a′·w`. The caller supplies the constant coefficient `c0`, that is
 * the branch of `a₀^r` it wants: the principal one for `jpow`, the real root
 * for `jroot`.
 */
function powFrom(a: number[], r: number, c0: number): number[] {
  const m = a.length;
  const c = zeroJet(m - 1);
  c[0] = c0;
  for (let k = 1; k < m; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += (j * r - (k - j)) * a[j] * c[k - j];
    c[k] = s / (k * a[0]);
  }
  return c;
}

/**
 * The sine and cosine jets of `a`, which satisfy a coupled recurrence and are
 * therefore computed together (`Tan` needs both as well).
 */
function jsincos(a: number[]): [number[], number[]] {
  const m = a.length;
  const s = zeroJet(m - 1);
  const c = zeroJet(m - 1);
  s[0] = Math.sin(a[0]);
  c[0] = Math.cos(a[0]);
  for (let k = 1; k < m; k++) {
    let sk = 0;
    let ck = 0;
    for (let j = 1; j <= k; j++) {
      sk += j * a[j] * c[k - j];
      ck += j * a[j] * s[k - j];
    }
    s[k] = sk / k;
    c[k] = -ck / k;
  }
  return [s, c];
}

/**
 * A complex jet: `2·(n + 1)` numbers, the real and imaginary part of each
 * Taylor coefficient interleaved (`c_k` at `[2k]`, `[2k + 1]`). Interleaving
 * keeps one allocation per value, which matters because a jet operation
 * allocates its result.
 */
type ComplexJet = number[];

/** The real part of a host value entering complex jet arithmetic. */
function reOf(x: unknown): number {
  if (typeof x === 'number') return x;
  if (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { re?: unknown }).re === 'number'
  )
    return (x as { re: number }).re;
  return NaN;
}

/** The imaginary part of a host value entering complex jet arithmetic. */
function imOf(x: unknown): number {
  if (typeof x === 'number') return 0;
  if (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { im?: unknown }).im === 'number'
  )
    return (x as { im: number }).im;
  return NaN;
}

/** A complex jet of `m` coefficients, all zero. */
function zeroComplexJet(m: number): ComplexJet {
  return new Array<number>(2 * m).fill(0);
}

/**
 * The coefficients of `a^r` above the constant one for a complex jet, from
 * the ODE `a·w′ = r·a′·w`. The caller supplies the constant coefficient
 * `c0r + i·c0i`, that is the branch of `a₀^r` it wants.
 */
function cpowFrom(
  a: ComplexJet,
  r: number,
  c0r: number,
  c0i: number
): ComplexJet {
  const m = a.length / 2;
  const c = zeroComplexJet(m);
  const a0r = a[0];
  const a0i = a[1];
  c[0] = c0r;
  c[1] = c0i;
  const d = a0r * a0r + a0i * a0i;
  for (let k = 1; k < m; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 1; j <= k; j++) {
      const w = j * r - (k - j);
      const ar = w * a[2 * j];
      const ai = w * a[2 * j + 1];
      const cr = c[2 * (k - j)];
      const ci = c[2 * (k - j) + 1];
      sr += ar * cr - ai * ci;
      si += ar * ci + ai * cr;
    }
    // Divide by `k · a₀`.
    const qr = sr / k;
    const qi = si / k;
    c[2 * k] = (qr * a0r + qi * a0i) / d;
    c[2 * k + 1] = (qi * a0r - qr * a0i) / d;
  }
  return c;
}

/** The sine and cosine of a complex jet, which satisfy a coupled recurrence. */
function jcsincos(a: ComplexJet): [ComplexJet, ComplexJet] {
  const m = a.length / 2;
  const s = zeroComplexJet(m);
  const c = zeroComplexJet(m);
  const ar = a[0];
  const ai = a[1];
  s[0] = Math.sin(ar) * Math.cosh(ai);
  s[1] = Math.cos(ar) * Math.sinh(ai);
  c[0] = Math.cos(ar) * Math.cosh(ai);
  c[1] = -Math.sin(ar) * Math.sinh(ai);
  for (let k = 1; k < m; k++) {
    let skr = 0;
    let ski = 0;
    let ckr = 0;
    let cki = 0;
    for (let j = 1; j <= k; j++) {
      const jr = j * a[2 * j];
      const ji = j * a[2 * j + 1];
      const i = k - j;
      skr += jr * c[2 * i] - ji * c[2 * i + 1];
      ski += jr * c[2 * i + 1] + ji * c[2 * i];
      ckr += jr * s[2 * i] - ji * s[2 * i + 1];
      cki += jr * s[2 * i + 1] + ji * s[2 * i];
    }
    s[2 * k] = skr / k;
    s[2 * k + 1] = ski / k;
    c[2 * k] = -ckr / k;
    c[2 * k + 1] = -cki / k;
  }
  return [s, c];
}

/**
 * The complex half of the jet runtime. Same recurrences as the real family
 * below, with each coefficient product replaced by a complex one; it is
 * emitted for a body whose own compilation promotes to the complex kernel
 * (an unknown-sign radical or logarithm), so that the two routes agree
 * outside the real domain as well as inside it.
 */
const COMPLEX_JET_HELPERS = {
  jck: (v: unknown, n: number): ComplexJet => {
    const c = zeroComplexJet(n + 1);
    c[0] = reOf(v);
    c[1] = imOf(v);
    return c;
  },
  jcv: (v: unknown, n: number): ComplexJet => {
    const c = zeroComplexJet(n + 1);
    c[0] = reOf(v);
    c[1] = imOf(v);
    if (n >= 1) c[2] = 1;
    return c;
  },
  jcread: (a: ComplexJet, n: number): { re: number; im: number } => {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return { re: a[2 * n] * f, im: a[2 * n + 1] * f };
  },
  jcadd: (a: ComplexJet, b: ComplexJet): ComplexJet =>
    a.map((x, k) => x + b[k]),
  jcsub: (a: ComplexJet, b: ComplexJet): ComplexJet =>
    a.map((x, k) => x - b[k]),
  jcneg: (a: ComplexJet): ComplexJet => a.map((x) => -x),
  jcmul: (a: ComplexJet, b: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    for (let k = 0; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 0; i <= k; i++) {
        const ar = a[2 * i];
        const ai = a[2 * i + 1];
        const br = b[2 * (k - i)];
        const bi = b[2 * (k - i) + 1];
        sr += ar * br - ai * bi;
        si += ar * bi + ai * br;
      }
      c[2 * k] = sr;
      c[2 * k + 1] = si;
    }
    return c;
  },
  jcsquare: (a: ComplexJet): ComplexJet => COMPLEX_JET_HELPERS.jcmul(a, a),
  /**
   * An INTEGER power, by exponentiation by squaring over jets — defined at a
   * zero of `a`, where the `a^r` recurrence's division by the constant
   * coefficient is not. A negative exponent is the reciprocal jet of the
   * positive power.
   */
  jcipow: (a: ComplexJet, p: number): ComplexJet => {
    const n = a.length / 2 - 1;
    if (p < 0)
      return COMPLEX_JET_HELPERS.jcdiv(
        COMPLEX_JET_HELPERS.jck(1, n),
        COMPLEX_JET_HELPERS.jcipow(a, -p)
      );
    if (p === 0) return COMPLEX_JET_HELPERS.jck(1, n);
    let r = a;
    let e = p;
    let acc: ComplexJet | undefined = undefined;
    while (e > 1) {
      if (e % 2 === 1)
        acc = acc === undefined ? r : COMPLEX_JET_HELPERS.jcmul(acc, r);
      r = COMPLEX_JET_HELPERS.jcmul(r, r);
      e = Math.floor(e / 2);
    }
    return acc === undefined ? r : COMPLEX_JET_HELPERS.jcmul(acc, r);
  },
  jcdiv: (a: ComplexJet, b: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const b0r = b[0];
    const b0i = b[1];
    const d = b0r * b0r + b0i * b0i;
    for (let k = 0; k < m; k++) {
      let sr = a[2 * k];
      let si = a[2 * k + 1];
      for (let i = 1; i <= k; i++) {
        const br = b[2 * i];
        const bi = b[2 * i + 1];
        const cr = c[2 * (k - i)];
        const ci = c[2 * (k - i) + 1];
        sr -= br * cr - bi * ci;
        si -= br * ci + bi * cr;
      }
      c[2 * k] = (sr * b0r + si * b0i) / d;
      c[2 * k + 1] = (si * b0r - sr * b0i) / d;
    }
    return c;
  },
  jcpow: (a: ComplexJet, r: number): ComplexJet => {
    const rho = Math.pow(Math.hypot(a[0], a[1]), r);
    const theta = r * Math.atan2(a[1], a[0]);
    return cpowFrom(a, r, rho * Math.cos(theta), rho * Math.sin(theta));
  },
  /**
   * `a^(1/k)` for an ODD integer `k`. A REAL negative constant coefficient
   * takes the real root, which is what the ordinary emitter answers there (it
   * lowers a cube root to `Math.cbrt`, on the real part); anywhere else the
   * principal branch is the one the complex kernel uses.
   */
  jcroot: (a: ComplexJet, k: number): ComplexJet => {
    const r = 1 / k;
    if (a[1] === 0 && a[0] < 0) return cpowFrom(a, r, -Math.pow(-a[0], r), 0);
    const rho = Math.pow(Math.hypot(a[0], a[1]), r);
    const theta = r * Math.atan2(a[1], a[0]);
    return cpowFrom(a, r, rho * Math.cos(theta), rho * Math.sin(theta));
  },
  jcsqrt: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const rho = Math.sqrt(Math.hypot(a[0], a[1]));
    const theta = Math.atan2(a[1], a[0]) / 2;
    c[0] = rho * Math.cos(theta);
    c[1] = rho * Math.sin(theta);
    const dr = 2 * c[0];
    const di = 2 * c[1];
    const d = dr * dr + di * di;
    for (let k = 1; k < m; k++) {
      let sr = a[2 * k];
      let si = a[2 * k + 1];
      for (let i = 1; i < k; i++) {
        const xr = c[2 * i];
        const xi = c[2 * i + 1];
        const yr = c[2 * (k - i)];
        const yi = c[2 * (k - i) + 1];
        sr -= xr * yr - xi * yi;
        si -= xr * yi + xi * yr;
      }
      c[2 * k] = (sr * dr + si * di) / d;
      c[2 * k + 1] = (si * dr - sr * di) / d;
    }
    return c;
  },
  jcexp: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const e = Math.exp(a[0]);
    c[0] = e * Math.cos(a[1]);
    c[1] = e * Math.sin(a[1]);
    for (let k = 1; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 1; i <= k; i++) {
        const ar = i * a[2 * i];
        const ai = i * a[2 * i + 1];
        const cr = c[2 * (k - i)];
        const ci = c[2 * (k - i) + 1];
        sr += ar * cr - ai * ci;
        si += ar * ci + ai * cr;
      }
      c[2 * k] = sr / k;
      c[2 * k + 1] = si / k;
    }
    return c;
  },
  jcln: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const a0r = a[0];
    const a0i = a[1];
    c[0] = Math.log(Math.hypot(a0r, a0i));
    c[1] = Math.atan2(a0i, a0r);
    const d = a0r * a0r + a0i * a0i;
    for (let k = 1; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 1; i < k; i++) {
        const cr = i * c[2 * i];
        const ci = i * c[2 * i + 1];
        const ar = a[2 * (k - i)];
        const ai = a[2 * (k - i) + 1];
        sr += cr * ar - ci * ai;
        si += cr * ai + ci * ar;
      }
      const qr = a[2 * k] - sr / k;
      const qi = a[2 * k + 1] - si / k;
      c[2 * k] = (qr * a0r + qi * a0i) / d;
      c[2 * k + 1] = (qi * a0r - qr * a0i) / d;
    }
    return c;
  },
  jcsin: (a: ComplexJet): ComplexJet => jcsincos(a)[0],
  jccos: (a: ComplexJet): ComplexJet => jcsincos(a)[1],
  jctan: (a: ComplexJet): ComplexJet => {
    const [s, c] = jcsincos(a);
    return COMPLEX_JET_HELPERS.jcdiv(s, c);
  },
};

/**
 * The runtime side of the lowering: truncated Taylor-jet arithmetic, injected
 * into compiled JavaScript as part of `_SYS`.
 *
 * A jet is a plain array of `n + 1` Taylor COEFFICIENTS (`c_k = f⁽ᵏ⁾/k!`),
 * not of derivatives — the coefficient form is what makes every recurrence
 * below a convolution with no factorials in it. `jread` converts back at the
 * end.
 *
 * Every recurrence is the standard one for its operation; they were checked
 * against the symbolic derivative's own numeric value before landing (see
 * `test/compute-engine/item-284-derivative-compile-cost.test.ts`).
 */
export const JET_HELPERS = {
  ...COMPLEX_JET_HELPERS,
  /** The jet of a value that does not vary with the differentiation point. */
  jk: (v: unknown, n: number): number[] => {
    const c = zeroJet(n);
    c[0] = asReal(v);
    return c;
  },
  /** The jet of the differentiation variable itself, at the point `v`. */
  jv: (v: unknown, n: number): number[] => {
    const c = zeroJet(n);
    c[0] = asReal(v);
    if (n >= 1) c[1] = 1;
    return c;
  },
  /** The n-th derivative read off a jet: `c_n · n!`. */
  jread: (a: number[], n: number): number => {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return a[n] * f;
  },
  jadd: (a: number[], b: number[]): number[] => a.map((x, k) => x + b[k]),
  jsub: (a: number[], b: number[]): number[] => a.map((x, k) => x - b[k]),
  jneg: (a: number[]): number[] => a.map((x) => -x),
  jmul: (a: number[], b: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    for (let k = 0; k < m; k++) {
      let s = 0;
      for (let i = 0; i <= k; i++) s += a[i] * b[k - i];
      c[k] = s;
    }
    return c;
  },
  jsquare: (a: number[]): number[] => JET_HELPERS.jmul(a, a),
  /**
   * An INTEGER power, by exponentiation by squaring over jets. Jet
   * multiplication is defined at a zero of `a`, where the `a^r` recurrence's
   * division by the constant coefficient is not — and a polynomial's
   * derivatives are defined there. A negative exponent is the reciprocal jet
   * of the positive power, which divides by the constant coefficient only
   * where the value itself is undefined.
   */
  jipow: (a: number[], p: number): number[] => {
    const n = a.length - 1;
    if (p < 0)
      return JET_HELPERS.jdiv(JET_HELPERS.jk(1, n), JET_HELPERS.jipow(a, -p));
    if (p === 0) return JET_HELPERS.jk(1, n);
    let r = a;
    let e = p;
    let acc: number[] | undefined = undefined;
    while (e > 1) {
      if (e % 2 === 1) acc = acc === undefined ? r : JET_HELPERS.jmul(acc, r);
      r = JET_HELPERS.jmul(r, r);
      e = Math.floor(e / 2);
    }
    return acc === undefined ? r : JET_HELPERS.jmul(acc, r);
  },
  jdiv: (a: number[], b: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = a[0] / b[0];
    for (let k = 1; k < m; k++) {
      let s = a[k];
      for (let i = 1; i <= k; i++) s -= b[i] * c[k - i];
      c[k] = s / b[0];
    }
    return c;
  },
  /** `a^r` for a real constant `r`, from the ODE `a·w′ = r·a′·w`. */
  jpow: (a: number[], r: number): number[] => powFrom(a, r, Math.pow(a[0], r)),
  /**
   * `a^(1/k)` for an ODD integer `k`: the REAL root, which for a negative
   * constant coefficient is `−|a₀|^(1/k)`. That is the value the interpreter
   * gives and the value the ordinary emitter gives (it lowers a cube root to
   * `Math.cbrt`), while `Math.pow` of a negative base is NaN. Only the
   * constant coefficient differs from `jpow`: the recurrence holds on this
   * branch too.
   */
  jroot: (a: number[], k: number): number[] => {
    const r = 1 / k;
    return powFrom(a, r, Math.sign(a[0]) * Math.pow(Math.abs(a[0]), r));
  },
  jsqrt: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.sqrt(a[0]);
    for (let k = 1; k < m; k++) {
      let s = a[k];
      for (let i = 1; i < k; i++) s -= c[i] * c[k - i];
      c[k] = s / (2 * c[0]);
    }
    return c;
  },
  jexp: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.exp(a[0]);
    for (let k = 1; k < m; k++) {
      let s = 0;
      for (let i = 1; i <= k; i++) s += i * a[i] * c[k - i];
      c[k] = s / k;
    }
    return c;
  },
  jln: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.log(a[0]);
    for (let k = 1; k < m; k++) {
      let s = 0;
      for (let i = 1; i < k; i++) s += i * c[i] * a[k - i];
      c[k] = (a[k] - s / k) / a[0];
    }
    return c;
  },
  jsin: (a: number[]): number[] => jsincos(a)[0],
  jcos: (a: number[]): number[] => jsincos(a)[1],
  jtan: (a: number[]): number[] => {
    const [s, c] = jsincos(a);
    return JET_HELPERS.jdiv(s, c);
  },
  /**
   * `|a|` away from a zero of `a`: the absolute value is `sign(a₀)·a` there,
   * so every coefficient takes the same sign. At `a₀ = 0` the sign is `0`,
   * which is the value the symbolic route's `Sign(0)` gives as well.
   */
  jabs: (a: number[]): number[] => {
    const g = Math.sign(a[0]);
    return a.map((x) => g * x);
  },
};
