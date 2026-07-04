import { besselI, besselK } from '/Users/arno/dev/compute-engine/src/compute-engine/numerics/special-functions';
for (const x of [10, 15, 19.99, 20, 20.01, 25, 29.99, 30]) console.log(`I ${x} ${besselI(0,x).toPrecision(17)} ${besselI(1,x).toPrecision(17)} ${besselI(2,x).toPrecision(17)}`);
for (const x of [1.49, 1.5, 1.51]) console.log(`K ${x} ${besselK(0,x).toPrecision(17)} ${besselK(1,x).toPrecision(17)} ${besselK(2,x).toPrecision(17)}`);
