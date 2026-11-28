/**
 * CE-1917: compiled JavaScript declines a call of a protocol method whose
 * body calls a function of the host, in a function that assigns a variable
 * of the engine. The same body as a plain user function compiles.
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1917-protocol-method-host-after-write.mts
 *
 * Each line prints whether the function compiles, or the decline reason.
 * The last line is READY when both compile.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compile';

const ce = new ComputeEngine();
ce.declare('hostTouch', {
  signature: '(any) -> nothing',
  pure: false,
  evaluate: () => ce.Nothing,
});
executeEpsil(
  ce,
  `
let cells = arrayFrom([0, 0, 0, 0], "integer<0..255>")
type Box = tuple<cells: array<integer<0..255>>>
protocol Ops { function touch(self: Self) -> nothing }
type Box is Ops { function touch(self: Box) -> nothing { hostTouch(self.cells) } }
let box = Box(cells)
let gen = 0
function touchAll() -> nothing { hostTouch(cells) }
let viaFunction = (t: integer) => do { gen = gen + 1; touchAll(); gen }
let viaMethod = (t: integer) => do { gen = gen + 1; box.touch(); gen }
`
);

let ready = true;
for (const name of ['viaFunction', 'viaMethod']) {
  let out = 'compiles';
  try {
    compile(ce.expr(name).evaluate(), { to: 'javascript', fallback: false });
  } catch (e) {
    ready = false;
    out = `DECLINE ${(e as Error).message}`;
  }
  console.log(`${name}: ${out}`);
}
console.log(ready ? 'READY' : 'NOT READY');
