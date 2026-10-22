import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  RationalNumberField,
  factorNumberFieldPolynomial,
} from '../../src/compute-engine/polynomial/number-field.js';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field.js';
import type { Element, Rational } from './corpus.js';

const backend = process.argv[2];
let gp: ((s: string) => string) | undefined;
if (backend === 'pari') {
  const module = await createRequire(import.meta.url)(
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
    runtime: process.version,
    pari: gp?.('version()'),
  })
);
const fields = new Map<string, RationalNumberField>();
const pariFields = new Set<string>();
const rational = ([n, d]: Rational) => q(BigInt(n), BigInt(d));
const gpPoly = (cs: Rational[], variable: string) =>
  `Polrev([${cs
    .map((c) => {
      const r = rational(c);
      return `(${r.numerator}/${r.denominator})`;
    })
    .join(',')}],${variable})`;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const msg = JSON.parse(line),
      key = JSON.stringify(msg.modulus);
    const setupStart = performance.now();
    if (gp) {
      const name = `nf${[...pariFields].indexOf(key) < 0 ? pariFields.size : [...pariFields].indexOf(key)}`;
      if (!pariFields.has(key)) {
        const response = gp(`${name}=nfinit(${gpPoly(msg.modulus, 'y')});1`);
        if (!/1\s*$/.test(response))
          throw new Error(`PARI field setup: ${response}`);
        pariFields.add(key);
      }
      const setupMs = performance.now() - setupStart;
      const conversionStart = performance.now();
      const input = `Polrev([${(msg.coefficients as Element[]).map((c) => gpPoly(c, 'y')).join(',')}],x)`;
      const conversionMs = performance.now() - conversionStart;
      const start = performance.now();
      // Coefficients are serialized in the supplied power basis, not nf.zk.
      const raw = gp(
        `my(f=${input},F=nffactor(${name},f));Str([Vecrev(lift(pollead(f))),vector(matsize(F)[1],i,[vector(poldegree(F[i,1])+1,j,Vecrev(lift(polcoef(F[i,1],j-1)))),F[i,2]])])`
      );
      const solveMs = performance.now() - start;
      const text = raw.trim().replace(/^%\d+ = /, '');
      if (!/^[\d\s,[\]/-]+$/.test(text)) throw new Error(`PARI output: ${raw}`);
      const parsed = JSON.parse(
        text.replace(/-?\d+(?:\/\d+)?/g, (s) => JSON.stringify(s))
      );
      const element = (cs: string[]): Element => {
        const out: Element = cs.map((s) => {
          const [n, d = '1'] = s.split('/');
          return [n, d];
        });
        while (out.length && out.at(-1)![0] === '0') out.pop();
        return out;
      };
      console.log(
        JSON.stringify({
          id: msg.id,
          setupMs,
          conversionMs,
          solveMs,
          result: {
            status: 'complete',
            coefficient: element(parsed[0]),
            factors: parsed[1].map(([cs, m]: [string[][], string]) => ({
              coefficients: cs.map(element),
              multiplicity: Number(m),
            })),
          },
        })
      );
    } else {
      if (!fields.has(key))
        fields.set(key, RationalNumberField.create(msg.modulus.map(rational)));
      const K = fields.get(key)!;
      const setupMs = performance.now() - setupStart;
      const conversionStart = performance.now();
      const input = (msg.coefficients as Element[]).map((c) =>
        K.element(c.map(rational))
      );
      const conversionMs = performance.now() - conversionStart;
      const start = performance.now();
      const r = factorNumberFieldPolynomial(K, input, {
        ...msg.options,
        profile: msg.profile,
      });
      const solveMs = performance.now() - start;
      const encode = (a: typeof K.one) =>
        a.coefficients.map((c) => [String(c.numerator), String(c.denominator)]);
      console.log(
        JSON.stringify(
          {
            id: msg.id,
            setupMs,
            conversionMs,
            solveMs,
            result: {
              ...r,
              field: undefined,
              remainder: undefined,
              coefficient: encode(r.coefficient),
              factors: r.factors.map((f) => ({
                coefficients: f.coefficients.map(encode),
                multiplicity: f.multiplicity,
              })),
            },
          },
          (_, v) => (typeof v === 'bigint' ? String(v) : v)
        )
      );
    }
  } catch (e) {
    console.log(JSON.stringify({ error: String(e) }));
  }
}
