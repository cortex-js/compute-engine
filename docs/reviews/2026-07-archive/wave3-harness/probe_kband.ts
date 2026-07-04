// CF2 (kahan) vs ascending series in the 1.0..2.0 band
function cf2(x: number): [number, number, number] {
  const a1 = 0.25;
  let b = 2 * (1 + x), d = 1 / b, h = d, delh = d;
  let q1 = 0, q2 = 1, a = -a1, c = a1, q = a1;
  let s = 1 + q * delh, compS = 0, compH = 0;
  let it = 0;
  for (let i = 2; i <= 10000; i++) {
    it = i;
    a -= 2 * (i - 1);
    c = (-a * c) / i;
    const qnew = (q1 - b * q2) / a;
    q1 = q2; q2 = qnew; q += c * qnew; b += 2;
    d = 1 / (b + a * d);
    delh = (b * d - 1) * delh;
    let y = delh - compH, u = h + y; compH = u - h - y; h = u;
    const dels = q * delh;
    y = dels - compS; u = s + y; compS = u - s - y; s = u;
    if (Math.abs(dels) < 1e-18 * Math.abs(s)) break;
  }
  h = a1 * h;
  const k0 = (Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x)) / s;
  return [k0, (k0 * (x + 0.5 - h)) / x, it];
}
import { besselK } from '/Users/arno/dev/compute-engine/src/compute-engine/numerics/special-functions';
for (const x of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.99]) {
  const [c0, c1, it] = cf2(x);
  // current kernel: series for x<2
  console.log(`x=${x} cf2K0=${c0.toPrecision(17)} cf2K1=${c1.toPrecision(17)} it=${it} serK0=${besselK(0,x).toPrecision(17)} serK1=${besselK(1,x).toPrecision(17)}`);
}
