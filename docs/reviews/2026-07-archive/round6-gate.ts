/**
 * Round-6 fresh-process gate: Wave-4 batches 3 (assume/verify), 4 (compile),
 * 5 (numerics) + F post-fixes (Root non-integer degree, complex decimal-exact
 * modulus, RT-P0-3 restoration).
 * Run: npx tsx round6-gate.ts
 */
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine.ts';
import { compile } from '/Users/arno/dev/compute-engine/src/compute-engine/compilation/compile-expression.ts';
import { PythonTarget } from '/Users/arno/dev/compute-engine/src/compute-engine/compilation/python-target.ts';
import { WGSLTarget } from '/Users/arno/dev/compute-engine/src/compute-engine/compilation/wgsl-target.ts';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

// ───────── Batch 3: assume/verify ─────────
{
  const ce = new ComputeEngine();
  ce.pushScope();
  check('B3: assume chained 0<x<1 ok', ce.assume(ce.parse('0 < x < 1')) === 'ok');
  check('B3: verify x>0 after chain', ce.verify(ce.parse('x > 0')) === true);
  check('B3: verify x<1 after chain', ce.verify(ce.parse('x < 1')) === true);
  ce.popScope();
}
{
  const ce = new ComputeEngine();
  ce.pushScope();
  check('B3: assume(x^2=4) ok (was contradiction)', ce.assume(ce.parse('x^2 = 4')) === 'ok');
  ce.popScope();
}
{
  const ce = new ComputeEngine();
  ce.pushScope();
  check('B3: assume(xy>0) ok', ce.assume(ce.parse('x \\cdot y > 0')) === 'ok');
  check('B3: verify(xy>0) identity', ce.verify(ce.parse('x \\cdot y > 0')) === true);
  check('B3: assume(x+y>0) ⇒ verify', ce.assume(ce.parse('x + y > 0')) === 'ok' && ce.verify(ce.parse('x + y > 0')) === true);
  ce.popScope();
}
{
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.assume(ce.parse('x > 4'));
  const res = ce.ask(ce.box(['Greater', 'x', '_k']));
  check('B3: B2 flipped-form bound query', res.length > 0);
  ce.popScope();
}
{
  const ce = new ComputeEngine();
  const x = ce.box('x'); // auto-declare in top scope
  x.evaluate();
  ce.pushScope();
  ce.assume(ce.parse('x > 0'));
  ce.popScope();
  check('B3: no type leak after popScope', ce.box('x').type.toString() !== 'real');
}

// ───────── Batch 4: compile ─────────
{
  const ce = new ComputeEngine();
  const python = new PythonTarget();
  const wgsl = new WGSLTarget();
  // Python: valid conditional syntax + keywords
  const src = python.compile(ce.box(['If', ['Greater', 'x', 0], 1, 2])).code;
  check('B4: python If → conditional expr', src.includes(' if ') && src.includes(' else ') && !src.includes('?'));
  const src2 = python.compile(ce.box(['And', ['Greater', 'x', 0], ['Less', 'x', 5]])).code;
  check('B4: python And → keyword', / and /.test(src2) && !/\band\(/.test(src2));
  // JS Equal tolerance
  const f = compile(ce.parse('0.1 + 0.2 = 0.3'));
  check('B4: compiled Equal tolerance', f?.run?.() === true || f?.fn?.() === true);
  // fail-closed: complex arg into Erf
  let threw = false;
  try {
    const ce2 = new ComputeEngine();
    ce2.declare('z', 'complex');
    compile(ce2.box(['Erf', 'z']), { fallback: false });
  } catch {
    threw = true;
  }
  check('B4: Erf(complex) fail-closed', threw);
  // GPU: nested min for 3-arg Min
  const wsrc = wgsl.compile(ce.box(['Min', 1.5, 'x', 2.5])).code.replace(/\s+/g, '');
  check('B4: wgsl 3-arg Min nested', /min\(min\(/.test(wsrc));
  // WGSL If → select, no ternary
  const wsrc2 = wgsl.compile(ce.box(['If', ['Greater', 'x', 0], 1.5, 2.5])).code;
  check('B4: wgsl If → select, no ?:', wsrc2.includes('select(') && !wsrc2.includes('?'));
}

// ───────── Batch 5: numerics ─────────
{
  const ce = new ComputeEngine();
  check('B5: Root(64,3).N() = 4 exactly', ce.box(['Root', 64, 3]).N().toString() === '4');
  check('B5: Root(-8,3) = -2', ce.box(['Root', -8, 3]).evaluate().toString() === '-2');
  const r44 = ce.box(['Root', -4, 4]).evaluate();
  check('B5: Root(-4,4).evaluate() not NaN literal', !r44.isNaN || r44.operator === 'Root');
  check('B5: Root(-4,4).N() complex', ce.box(['Root', -4, 4]).N().toString().includes('i'));
  // F post-fix: non-integer degrees (type-soundness regression)
  check('B5F: Root(2,0.5) = 4', ce.box(['Root', 2, 0.5]).N().toString() === '4');
  check('B5F: Root(0,0.5) = 0', ce.box(['Root', 0, 0.5]).N().toString() === '0');
  check('B5F: Root(2,-0.5) = 0.25', ce.box(['Root', 2, -0.5]).N().toString() === '0.25');
  check('B5F: Root(-2,3.7) finite', Number.isFinite(ce.box(['Root', -2, 3.7]).N().re));
}
{
  const ce = new ComputeEngine();
  ce.precision = 50;
  // LambertW rounded, no garbage tail
  const w = ce.box(['LambertW', 3]).N().toString();
  // mpmath: 1.049908894964039959988697070552897904589466943706341453
  check('B5: LambertW(3)@50 matches mpmath', w.startsWith('1.04990889496403995998869707055289790458946694370'));
  check('B5: LambertW(3)@50 no 2x-precision tail', w.length <= 54);
  // acos near 1 — mpmath: acos(1-1e-20) = 1.4142135623730950488e-10
  const ac = ce.box(['Arccos', { num: '0.99999999999999999999' }] as any).N().toString();
  check('B5: acos near 1 cancellation-free', ac.startsWith('1.4142135623730950488') || ac.includes('e-10'));
  // Power ladder — 0.999999999999^1e6 @34 (mpmath: 0.9999990000004999998333...)
  ce.precision = 34;
  const pw = ce.box(['Power', { num: '0.999999999999' }, 1000000] as any).N().toString();
  // mpmath: 0.9999990000004999993333338749994083338763883261910132658
  check('B5: pow ladder guard digits', pw.startsWith('0.9999990000004999993333338749994083'));
  // RT-P0-3 lossless complex json (F post-fix restored)
  ce.precision = 50;
  const c = ce.box(['Complex', { num: '1.' + '4'.repeat(40) }, 1] as any);
  check('B5F: RT-P0-3 lossless complex json', JSON.stringify(c.json).includes('4'.repeat(40)));
  // Complex decimal-exact modulus (F post-fix): Ln(1.1+1.1i) @21 matches mpmath face value
  ce.precision = 21;
  const ln = ce.box(['Ln', ['Complex', 1.1, 1.1]]).evaluate().toString();
  check('B5F: Ln(1.1+1.1i) 21 correct digits', ln.startsWith('(0.441883770084297514751'));
  // Power(-4,0.25) working-precision phase (F post-fix)
  ce.precision = 50;
  const p = ce.box(['Power', -4, 0.25]).N().toString();
  check('B5F: Power(-4,0.25) ~1+i at 50 digits', p.startsWith('(0.99999999999999999999999999999999999999999999999') && p.includes('+ i'));
  check('B5F: Power(-4,0.25) no 2x tail', p.length < 60);
  // Sqrt(2+3i) full-precision re preserved (not truncated to 17)
  const s = ce.box(['Sqrt', ['Complex', 2, 3]]).N().toString();
  check('B5F: Sqrt(2+3i) re full 50 digits', s.startsWith('(1.6741492280355400404480393008490518216747086778839'));
}
{
  // 2F1 near z=1 (bignum) — mpmath: hyp2f1(1,1,2,0.99) = 4.6517...
  const ce = new ComputeEngine();
  ce.precision = 30;
  const h = ce.box(['Hypergeometric2F1', 1, 1, 2, { num: '0.99' }] as any).N().toString();
  // mpmath: 4.6516870565536276444807908175441701
  check('B5: 2F1(1,1,2,0.99) converges', h.startsWith('4.65168705655362764448079081754'));
  // erfInv near 1 (machine)
  ce.precision = 15;
  const ei = ce.box(['ErfInv', { num: '0.999999999999' }] as any).N().re;
  // mpmath erfinv(double 0.999999999999) = 5.042031898572696130052925
  check('B5: erfInv(1-1e-12) 16 digits of double truth', Math.abs(ei - 5.042031898572696) < 1e-14);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
