/**

    Translated from https://github.com/JuliaMath/Richardson.jl/blob/master/src/Richardson.jl


    The `Richardson` module provides a function `extrapolate` that
    extrapolates a given function `f(x)` to `f(x0)`, evaluating
    `f` only  at a geometric sequence of points `> x0`
    (or optionally `< x0`).
    
    The key algorithm is Richardson extrapolation using a Neville—Aitken
    tableau, which adaptively increases the degree of an extrapolation
    polynomial until convergence is achieved to a desired tolerance
    (or convergence stalls due to e.g. floating-point errors).  This
    allows one to obtain `f(x0)` to high-order accuracy, assuming
    that `f(x0+h)` has a Taylor series or some other power
    series in `h`.
*/

export interface ExtrapolateOptions {
  contract?: number; // contract the step size by this factor on each step
  step?: number; // initial step size
  power?: number; // power of h in the extrapolation polynomial
  atol?: number; // absolute tolerance
  rtol?: number; // relative tolerance
  maxeval?: number; // maximum number of function evaluations
  breaktol?: number; // break if error increases by more than this factor
}

// function norm(arr: NumberArray): number {
//   return Math.sqrt(arr.reduce((acc, val) => acc + val * val, 0));
// }

/** 
 * 
 * Extrapolate `f(x)` to `f₀ ≈ f(x0)`, evaluating `f` only at `x > x0` points
(or `x < x0` if `h < 0`) using Richardson extrapolation starting at
`x=x₀+h`.  It returns a tuple `(f₀, err)` of the estimated `f(x0)`
and an error estimate.

The return value of `f` can be any type supporting `±` and `norm`
operations (i.e. a normed vector space).
Similarly, `h` and `x0` can be in any normed vector space,
in which case `extrapolate` performs Richardson extrapolation
of `f(x0+s*h)` to `s=0⁺` (i.e. it takes the limit as `x` goes
to `x0` along the `h` direction).

On each step of Richardson extrapolation, it shrinks `x-x0` by
a factor of `contract`, stopping when the estimated error is
`< max(rtol*norm(f₀), atol)`, when the estimated error
increases by more than `breaktol` (e.g. due to numerical errors in the
computation of `f`), when `f` returns a non-finite value (`NaN` or `Inf`),
 or when `f` has been evaluated `maxeval` times.   Note that
if the function may converge to zero, you may want
specify a nonzero `atol` (which cannot be set by default
because it depends on the scale/units of `f`); alternatively,
in such cases `extrapolate` will halt when it becomes
limited by the floating-point precision.   (Passing `breaktol=Inf`
can be useful to force `extrapolate` to continue shrinking `h` even
if polynomial extrapolation is initially failing to converge,
possibly at the cost of extraneous function evaluations.)


If `x0 = ±∞` (`±Inf`), then `extrapolate` computes the limit of
`f(x)` as `x ⟶ ±∞` using geometrically *increasing* values
of `h` (by factors of `1/contract`).

In general, the starting `h` should be large enough that `f(x0+h)`
can be computed accurately and efficiently (e.g. without
severe cancellation errors), but small enough that `f` does not
oscillate much between `x0` and `h`.  i.e. `h` should be a typical
scale over which the function `f` varies significantly.

Technically, Richardson extrapolation assumes that `f(x0+h)` can
be expanded in a power series in `h^power`, where the default
`power=1` corresponds to an ordinary Taylor series (i.e. assuming
`f` is analytic at `x0`).  If this is not true, you may obtain
slow convergence from `extrapolate`, but you can pass a different
value of `power` (e.g. `power=0.5`) if your `f` has some different
(Puiseux) power-series expansion.   Conversely, if `f` is
an *even* function around `x0`, i.e. `f(x0+h) == f(x0-h)`,
so that its Taylor series contains only *even* powers of `h`,
you can accelerate convergence by passing `power=2`.

 */
export function extrapolate(
  f: (x: number) => number,
  x0: number,
  options: ExtrapolateOptions = {}
): [val: number, err: number] {
  const {
    contract = 0.125,
    step = 1,
    power = 2,
    atol = 1e-16,
    rtol = atol > 0 ? 0 : Math.sqrt(Number.EPSILON),
    maxeval = 1e6, // Number.MAX_SAFE_INTEGER
    breaktol = 2,
  } = options;

  if (!isFinite(x0)) {
    // use a change of variables x = 1/u
    return extrapolate((u) => f(1 / u), 1 / x0, {
      rtol,
      atol,
      maxeval,
      contract: Math.abs(contract) > 1 ? 1 / contract : contract,
      step: 1 / step,
      power,
    });
  }

  let h = step;
  let invcontract = Math.pow(1 / contract, power);
  let f0 = f(x0 + h);
  let neville: number[] = [f0]; // The current diagonal of the Neville tableau
  let err = Infinity;
  let numeval = 1;

  while (numeval < maxeval) {
    numeval += 1;
    h *= contract;
    neville.push(f(x0 + h));
    let c = invcontract;
    let minerr = Infinity;

    for (let i = neville.length - 2; i >= 0; i--) {
      const old = neville[i];
      neville[i] = neville[i + 1] + (neville[i + 1] - neville[i]) / (c - 1);
      const err_ = Math.abs(neville[i] - old);
      minerr = Math.min(minerr, err_);

      if (err_ < err) {
        f0 = neville[i];
        err = err_;
      }
      c *= invcontract;
    }

    if (minerr > breaktol * err || !isFinite(minerr)) break;
    if (err <= Math.max(rtol * Math.abs(f0), atol)) break;
  }

  return [f0, err];
}
