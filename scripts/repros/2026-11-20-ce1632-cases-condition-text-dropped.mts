// A `\text{…}` operand in the condition of a `cases` row is dropped: the
// condition `m = \text{cubic}` parses as `Equal(m)`, which is true for every
// value of `m`, so the first row is taken whatever `m` is. Outside `cases`,
// `m = \text{cubic}` parses as `Equal(m, "cubic")`.
//
// Run: npx tsx scripts/repros/2026-11-20-ce1631-cases-condition-text-dropped.mts
//
// Output at 44428e9cfb855c44f69fc5ceef8ca3f565796ef8 (2026-11-20):
//   m = \text{cubic}  ->  ["Equal","m","'cubic'"]
//   cases, m = \text{cubic}  ->  ["Which",["Equal","m"],["Power","x",3],"True","x"]
//   cases, \text{if } m = \text{cubic}  ->  ["Which",["Equal","m"],["Power","x",3],"True","x"]
//   cases, m = 1  ->  ["Which",["Equal","m",1],["Power","x",3],"True","x"]
//   x = 2, m = "lin": cases gives 8, If(Equal(m, "cubic"), x^3, x) gives 2
import { ComputeEngine } from '../../src/compute-engine.ts';

const ce = new ComputeEngine();
ce.declare('m', 'string');
ce.declare('x', 'real');
const row = (cond: string) =>
  `\\begin{cases} x^3 & ${cond} \\\\ x & \\text{otherwise} \\end{cases}`;
const show = (label: string, latex: string) =>
  console.log(`${label}  ->  ${JSON.stringify(ce.parse(latex).json)}`);

show('m = \\text{cubic}', 'm = \\text{cubic}');
show('cases, m = \\text{cubic}', row('m = \\text{cubic}'));
show('cases, \\text{if } m = \\text{cubic}', row('\\text{if } m = \\text{cubic}'));
show('cases, m = 1', row('m = 1'));

ce.assign('x', 2);
ce.assign('m', ce.box({ str: 'lin' }));
const viaCases = ce.parse(row('m = \\text{cubic}')).evaluate().json;
const viaIf = ce
  .box(['If', ['Equal', 'm', { str: 'cubic' }], ['Power', 'x', 3], 'x'])
  .evaluate().json;
console.log(`x = 2, m = "lin": cases gives ${viaCases}, If(Equal(m, "cubic"), x^3, x) gives ${viaIf}`);
