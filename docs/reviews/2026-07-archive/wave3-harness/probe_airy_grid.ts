import { airyAi, airyBi, besselK, besselI } from '/Users/arno/dev/compute-engine/src/compute-engine/numerics/special-functions';
const xs = [-30, -15, -9.01, -9, -8.99, -8, -7, -6, -3, -2, -0.5, 0, 0.5, 2, 3, 7, 8.99, 9, 9.01, 15, 30, 100];
for (const x of xs) console.log(`Ai ${x} ${airyAi(x).toPrecision(17)} Bi ${airyBi(x).toPrecision(17)}`);
// bessel crossovers too
for (const x of [1.99, 2, 2.01, 19.99, 20, 20.01]) console.log(`K0 ${x} ${besselK(0,x).toPrecision(17)} K1 ${x} ${besselK(1,x).toPrecision(17)}`);
for (const x of [29.99, 30, 30.01]) console.log(`I0 ${x} ${besselI(0,x).toPrecision(17)} I1 ${x} ${besselI(1,x).toPrecision(17)}`);
