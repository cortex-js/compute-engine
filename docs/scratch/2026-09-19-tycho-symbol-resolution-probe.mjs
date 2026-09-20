// Run from compute-engine:
// node --import tsx docs/scratch/2026-09-19-tycho-symbol-resolution-probe.mjs ../tycho [CE module]
// The optional CE module can be ../ce-wt-ask305/src/compute-engine.ts.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const tychoRoot = resolve(process.argv[2] ?? '../tycho');
const ceModulePath = resolve(process.argv[3] ?? resolve(
  tychoRoot, 'node_modules/@cortex-js/compute-engine/dist/esm-min/compute-engine.js',
));
const ceModule = await import(pathToFileURL(ceModulePath).href);
const { registerComputeEngineModule } = await import(pathToFileURL(resolve(
  tychoRoot, 'src/plot-core/ce-module-registry.ts',
)).href);
const { DocumentCEManager } = await import(pathToFileURL(resolve(
  tychoRoot, 'src/graph-paper/graph/document-ce-manager.ts',
)).href);
registerComputeEngineModule(ceModule);

const config = {
  angleUnit: 'radians', decimalSeparator: '.', digitGroupSeparator: '\\,',
  numberNotation: 'auto', digits: 'auto', repeatingDecimal: 'auto',
  fractionStyle: 'quotient', rootStyle: 'radical', logicStyle: 'word',
  multiplySymbol: 'cross', prettify: true,
  avoidExponentsInRange: { min: -4, max: 5 }, dmsFormat: false,
};
const cells = (rows) => rows.map((latex) => ({ latex, visible: true }));
function manager(rows) {
  const mgr = new DocumentCEManager(config);
  mgr.setCells(cells(rows));
  mgr.evaluate();
  return mgr;
}

for (const rows of [
  ['f(x)=a(x+1)'],
  ['f(x)=A(x+1)'],
  ['f(x)=L_1+x', 'L=[1,2]'],
  ['L=[1,2]', 'f(x)=L_1+x'],
  ['L=M', 'M=[1,2]', 'f(x)=L_1+x'],
  ['M=[1,2]', 'L=M', 'f(x)=L_1+x'],
]) {
  const mgr = manager(rows);
  console.log(JSON.stringify({
    rows,
    definitions: [...mgr.definitions].map(([name, d]) => ({ name, body: d.bodyJson })),
    freshFunctionRow: mgr.ce.parse(rows.find((s) => s.startsWith('f('))).json,
    f2: mgr.ce.parse('f(2)').evaluate().json,
  }));
  mgr.dispose();
}

{
  const mgr = manager(['f(x)=x+1', 'g(f)=f(x+1)']);
  console.log(JSON.stringify({ case: 'parameter scope', actual:
    mgr.withRowParamScope('g(f)=f(x+1)', () => ({
      type: mgr.ce.expr('f').type.toString(),
      expression: mgr.ce.parse('f(x+1)').json,
    })),
  }));
  mgr.ce.pushScope();
  mgr.ce.declare('f', 'number');
  console.log(JSON.stringify({ case: 'explicit numeric shadow',
    type: mgr.ce.expr('f').type.toString(), expression: mgr.ce.parse('f(x+1)').json,
  }));
  mgr.ce.popScope();
  mgr.setCells(cells(['y=f(x+1)']));
  mgr.evaluate();
  console.log(JSON.stringify({ case: 'function removed',
    vouched: mgr.isDocumentFn('f'), expression: mgr.ce.parse('f(x+1)').json,
  }));
  mgr.dispose();
}
