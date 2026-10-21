import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { factorRationalPolynomial } from '../../src/compute-engine/polynomial/factor-rational.js';
import {
  integerGcd,
  rationalCoefficient as q,
  rationalField as Q,
} from '../../src/compute-engine/polynomial/exact-field.js';

const backend = process.argv[2],
  start = performance.now();
if (!['typescript', 'pari'].includes(backend))
  throw new Error('Unknown worker backend');
let gp: ((s: string) => string) | undefined;
if (backend === 'pari') {
  const require = createRequire(import.meta.url);
  const module = await require(
    resolve(
      'build/factoring-backends/node_modules/@sagemath/pari/dist/gp-sta.js'
    )
  )({
    noInitialRun: true,
    wasmBinary: readFileSync(
      'build/factoring-backends/node_modules/@sagemath/pari/dist/gp-sta.wasm'
    ),
  });
  module.ccall(
    'gp_embedded_init',
    null,
    ['number', 'number'],
    [64 * 1024 * 1024, 64 * 1024 * 1024]
  );
  gp = module.cwrap('gp_embedded', 'string', ['string']);
}
console.log(
  JSON.stringify({
    ready: true,
    initializationMs: performance.now() - start,
    runtime: process.version,
  })
);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const message = JSON.parse(line);
    const conversionStart = performance.now();
    const input = (message.coefficients as [string, string][]).map(([n, d]) =>
      q(BigInt(n), BigInt(d))
    );
    const conversionMs = performance.now() - conversionStart;
    const solveStart = performance.now();
    if (gp) {
      // Only validated bigint literals are interpolated into the CAS program.
      const vector = input
        .map((c) => `(${c.numerator}/${c.denominator})`)
        .join(',');
      const source = `my(f=Polrev([${vector}]),F=factor(f));Str([pollead(f)/prod(i=1,matsize(F)[1],pollead(F[i,1])^F[i,2]),vector(matsize(F)[1],i,[Vecrev(F[i,1]),F[i,2]])])`;
      const raw = gp(source);
      const solveMs = performance.now() - solveStart;
      const payload = raw.trim().replace(/^%\d+ = /, '');
      if (!/^[\d\s,[\]/-]+$/.test(payload))
        throw new Error(`Unexpected PARI output: ${raw}`);
      const parsed = JSON.parse(
        payload.replace(/-?\d+(?:\/\d+)?/g, (s) => JSON.stringify(s))
      ) as [string, [string[], string][]];
      const parseRational = (s: string) => {
        const [n, d = '1'] = s.split('/');
        return q(BigInt(n), BigInt(d));
      };
      let coefficient = parseRational(parsed[0]);
      const factors = parsed[1].map(([cs, m]) => {
        const rs = cs.map(parseRational),
          multiplicity = Number(m);
        let denominator = 1n;
        for (const c of rs)
          denominator =
            (denominator / integerGcd(denominator, c.denominator)) *
            c.denominator;
        const ints = rs.map((c) => c.numerator * (denominator / c.denominator));
        let content = 0n;
        for (const c of ints) content = integerGcd(content, c);
        if (ints[ints.length - 1] < 0n) content = -content;
        const coefficients = ints.map((c) => c / content);
        for (let i = 0; i < multiplicity; i++)
          coefficient = Q.mul(coefficient, q(content, denominator));
        return { coefficients: coefficients.map(String), multiplicity };
      });
      console.log(
        JSON.stringify({
          id: message.id,
          backend,
          result: {
            status: 'complete',
            coefficient: {
              numerator: String(coefficient.numerator),
              denominator: String(coefficient.denominator),
            },
            factors,
          },
          solveMs,
          conversionMs,
          rss: process.memoryUsage().rss,
        })
      );
    } else {
      const result = factorRationalPolynomial(input, {
        maxOperations: message.maxOperations ?? 2_000_000,
        maxDegree: message.maxDegree ?? 128,
        maxCoefficientBits: message.maxCoefficientBits ?? 4096,
        profile: message.profile ?? false,
        lifting: message.lifting ?? 'auto',
      });
      console.log(
        JSON.stringify(
          {
            id: message.id,
            backend,
            result,
            solveMs: performance.now() - solveStart,
            conversionMs,
            rss: process.memoryUsage().rss,
          },
          (_, v) => (typeof v === 'bigint' ? v.toString() : v)
        )
      );
    }
  } catch (e) {
    console.log(JSON.stringify({ error: String(e) }));
  }
}
