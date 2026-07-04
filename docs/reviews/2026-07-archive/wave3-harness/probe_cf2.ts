// Probe CF2 variants for K0/K1 at small-x boundary
function cf2(x: number, kahan: boolean): [number, number, number] {
  const a1 = 0.25;
  let b = 2 * (1 + x);
  let d = 1 / b;
  let h = d, delh = d;
  let q1 = 0, q2 = 1;
  let a = -a1, c = a1, q = a1;
  let s = 1 + q * delh;
  let compS = 0, compH = 0;
  let iters = 0;
  for (let i = 2; i <= 10000; i++) {
    iters = i;
    a -= 2 * (i - 1);
    c = (-a * c) / i;
    const qnew = (q1 - b * q2) / a;
    q1 = q2; q2 = qnew;
    q += c * qnew;
    b += 2;
    d = 1 / (b + a * d);
    delh = (b * d - 1) * delh;
    if (kahan) {
      let y = delh - compH; let u = h + y; compH = u - h - y; h = u;
    } else h += delh;
    const dels = q * delh;
    if (kahan) {
      let y = dels - compS; let u = s + y; compS = u - s - y; s = u;
    } else s += dels;
    if (Math.abs(dels) < 1e-18 * Math.abs(s)) break;
  }
  h = a1 * h;
  const k0 = (Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x)) / s;
  const k1 = (k0 * (x + 0.5 - h)) / x;
  return [k0, k1, iters];
}
for (const x of [1.0, 1.5, 2.0, 2.5, 3.0, 5.0, 10.0]) {
  const [p0, p1, it] = cf2(x, false);
  const [k0, k1, it2] = cf2(x, true);
  console.log(`x=${x} plain: K0=${p0.toPrecision(17)} K1=${p1.toPrecision(17)} iters=${it}`);
  console.log(`x=${x} kahan: K0=${k0.toPrecision(17)} K1=${k1.toPrecision(17)} iters=${it2}`);
}
