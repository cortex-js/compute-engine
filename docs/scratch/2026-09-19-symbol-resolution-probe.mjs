// Observational probe for the accompanying investigation, not a regression test.
// Run from compute-engine:
// node --import tsx docs/scratch/2026-09-19-symbol-resolution-probe.mjs [CE repo]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const { ComputeEngine } = await import(
  pathToFileURL(resolve(root, 'src/compute-engine.ts')).href
);
const emit = (name, result) => console.log(JSON.stringify({ name, ...result }));
const install = (ce, resolveSymbol) => {
  ce.latexOptions = { ...ce.latexOptions, resolveSymbol };
};
const symbolType = (ce, name) =>
  ce.lookupDefinition(name)?.value?.type.toString();

for (const mode of ['declare', 'resolver']) {
  for (const type of ['real', 'list<real>']) {
    for (const source of ['f(x+1)', 'f(x,y)', 'f()']) {
      const ce = new ComputeEngine();
      if (mode === 'declare') ce.declare('f', type);
      else install(ce, (name) => (name === 'f' ? { type } : undefined));
      const expression = ce.parse(source);
      emit('binding-fact-parity', {
        mode, type, source, json: expression.json,
        resultType: expression.type.toString(), headType: symbolType(ce, 'f'),
      });
    }
  }
}

for (const declaredType of ['real', 'function']) {
  const ce = new ComputeEngine();
  ce.declare('f', declaredType);
  let headCalls = 0;
  install(ce, (name) => {
    if (name !== 'f') return undefined;
    headCalls++;
    return { type: declaredType === 'real' ? 'function' : 'real' };
  });
  const expression = ce.parse('f(x+1)');
  emit('declaration-precedence', { declaredType, json: expression.json, headCalls });
}

for (const source of ['f(f+1)', 'F(F+1)', 'f(x)[1]']) {
  const ce = new ComputeEngine();
  emit('default-heuristic', { source, json: ce.parse(source).json });
}

{
  const ce = new ComputeEngine();
  const cached = ce.parse('L_1', { form: 'raw' }).json;
  ce.declare('L', 'list<real>');
  const fresh = ce.parse('L_1').json;
  const reboxed = ce.box(cached).json;
  emit('late-list-declaration', {
    cached, fresh, reboxed, freshAfterRebox: ce.parse('L_1').json,
  });
}

for (const deferred of [false, true]) {
  const ce = new ComputeEngine();
  const resolveSymbol = (name) => name === 'a' ? { type: 'value' } : undefined;
  const expression = ce.parse('a(x+1)', {
    resolveSymbol, ...(deferred ? { form: 'raw' } : {}),
  });
  emit('per-call-policy-lifetime', {
    deferred, before: expression.json, canonical: expression.canonical.json,
  });
}

{
  const ce = new ComputeEngine();
  install(ce, (name, context) => name === 'a' ? {
    type: context?.afterGroup === '+' ? 'value' : 'function',
  } : undefined);
  const expression = ce.parse('a(x)+1', { form: 'raw' });
  emit('context-reversal', { raw: expression.json, canonical: expression.canonical.json });
}

for (const source of ['f(x)=f(x+1)', 'a(x)+a(x)=0', '(f(x))=y', 'f(x+1)=y']) {
  const ce = new ComputeEngine();
  install(ce, (_name, context) => ({
    type: context?.followedByGroup && context.afterGroup === '=' ? 'function' : 'value',
  }));
  const expression = ce.parse(source);
  emit('next-token-definition-policy', {
    source, json: expression.json, valid: expression.isValid,
    fType: symbolType(ce, 'f'), aType: symbolType(ce, 'a'),
  });
}

{
  const ce = new ComputeEngine();
  install(ce, () => ({ type: 'function' }));
  emit('parameter-shadowing', {
    json: ce.parse('(x,N) \\mapsto x(N+1)').json,
  });
}
