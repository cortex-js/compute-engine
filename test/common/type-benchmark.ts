/**
 * Micro-benchmark for the type system (REVIEW.md performance cluster).
 *
 * Measures:
 *  1. parseType() over a representative set of type strings (hot-path call
 *     sites pass identical literal strings per evaluation, so repeated parses
 *     of the same string dominate).
 *  2. isSubtype() over representative pairs (including string operands, which
 *     trigger parseType internally).
 *  3. widen()/narrow() over representative pairs (exercises superType and
 *     unionTypes).
 *  4. reduceType() over union/intersection types (exercises the dedup path).
 *
 * Run with: npx tsx test/common/type-benchmark.ts
 */

import { parseType } from '../../src/common/type/parse';
import { isSubtype, widen, narrow } from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';
import type { Type } from '../../src/common/type/types';

const TYPE_STRINGS = [
  'indexed_collection<integer>',
  'list<number>',
  'matrix<integer^(2x3)>',
  'tuple<x: integer, y: integer>',
  '(number, number) -> number',
  'integer | rational | real',
  'collection<number>',
  'set<finite_complex>',
  'record<x: integer, y: string>',
  'number & real',
  'integer<0..10>',
  'vector<3>',
  'dictionary<number>',
  'string | nothing',
  'finite_real',
];

const SUBTYPE_PAIRS: [Type | string, Type | string][] = [
  ['integer', 'number'],
  ['finite_integer', 'finite_real'],
  ['real', 'complex'],
  ['list<integer>', 'list<number>'],
  ['list<integer>', 'collection<number>'],
  ['tuple<integer, integer>', 'indexed_collection<number>'],
  ['(integer) -> integer', '(number) -> number'],
  ['integer | rational', 'real'],
  ['set<integer>', 'set<number>'],
  ['record<x: integer>', 'record<x: number>'],
  ['matrix<integer^(2x3)>', 'matrix'],
  ['string', 'number'],
];

const WIDEN_PAIRS: [Type, Type][] = [
  ['integer', 'rational'],
  ['finite_integer', 'finite_real'],
  ['integer', 'imaginary'],
  ['real', 'complex'],
  ['integer', 'string'],
  ['boolean', 'string'],
  [parseType('list<integer>'), parseType('list<real>')],
  ['finite_number', 'real'],
];

const REDUCE_TYPES: Type[] = [
  { kind: 'union', types: ['integer', 'rational', 'real'] },
  { kind: 'intersection', types: ['integer', 'finite_real'] },
  { kind: 'union', types: ['integer', 'integer', 'number'] },
  {
    kind: 'union',
    types: [parseType('list<integer>'), parseType('list<integer>')],
  },
  { kind: 'intersection', types: ['finite_number', 'real'] },
];

function bench(name: string, n: number, fn: () => void): void {
  // Warmup
  for (let i = 0; i < Math.min(n, 1000); i++) fn();
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = ((elapsed / n) * 1e6).toFixed(2);
  console.log(
    `${name.padEnd(32)} ${elapsed.toFixed(1).padStart(8)} ms total  ${perOp.padStart(9)} ns/iter`
  );
}

console.log(`Node ${process.version}`);

bench('parseType (15 strings)', 20000, () => {
  for (const s of TYPE_STRINGS) parseType(s);
});

bench('isSubtype (12 pairs, strings)', 20000, () => {
  for (const [a, b] of SUBTYPE_PAIRS) isSubtype(a as Type, b as Type);
});

const PARSED_PAIRS = SUBTYPE_PAIRS.map(
  ([a, b]) =>
    [
      typeof a === 'string' ? parseType(a) : a,
      typeof b === 'string' ? parseType(b) : b,
    ] as [Type, Type]
);

bench('isSubtype (12 pairs, parsed)', 50000, () => {
  for (const [a, b] of PARSED_PAIRS) isSubtype(a, b);
});

bench('widen (8 pairs)', 50000, () => {
  for (const [a, b] of WIDEN_PAIRS) widen(a, b);
});

bench('narrow (8 pairs)', 50000, () => {
  for (const [a, b] of WIDEN_PAIRS) narrow(a, b);
});

bench('reduceType (5 types)', 20000, () => {
  for (const t of REDUCE_TYPES) reduceType(t);
});
