import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { MathJsonExpression } from '../../src/math-json/types';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { attachScalarFragment, enterScalarFragment } from '../../src/compute-engine/compilation/javascript-fragment-facts';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

function setup() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real'); ce.declare('y', 'real'); ce.declare('z', 'complex'); ce.declare('C', 'boolean');
  return {ce, target: new ScalarFragmentJavaScriptTarget()};
}
const cases: MathJsonExpression[] = [
  ['Add', 'x', 'y'], ['Add', 'x', 'z'], ['Negate', 'x'], ['Negate', 'z'],
  ['Sqrt', 'x'], ['Sqrt', 'z'], ['Sqrt', -4],
  ['If', 'C', 'x', 'z'], ['If', 'C', ['Sqrt', 'x'], ['Negate', 'z']],
  ['Add', ['Sqrt', 'x'], ['Sqrt', 'y']],
  ['Add', ['Sqrt', 'x'], ['Sqrt', ['Add', ['Sqrt', 'x'], 'y']]],
];
for (const mode of ['strict','complex'] as const) for (const cse of [false,true]) for (const constantFold of [false,true]) {
  describe(`${mode} cse=${cse} fold=${constantFold}`,()=>{
    test.each(cases.map(json=>({json})))('agrees with existing JS for $json',({json})=>{
      const {ce,target}=setup();const expr=ce.expr(json);const options={mode,cse,constantFold,fallback:false};
      const before=compile(expr,options);const annotated=target.compile(expr,options);const after=compile(expr,options);
      expect(annotated.success).toBe(true);expect(after.code).toBe(before.code);
      for(const x of [-4,0,9])for(const C of [false,true]){
        const input={x,y:4,z:{re:3,im:4},C};
        expect(annotated.run!(input)).toEqual(before.run!(input));
      }
    });
  });
}
test('different annotated lanes choose real and complex lowering',()=>{
  const {ce,target}=setup();
  const real=target.compile(ce.expr(['Sqrt','x']),{mode:'strict',constantFold:false});
  const complex=target.compile(ce.expr(['Sqrt','x']),{mode:'complex',constantFold:false});
  expect(real.code).toContain('Math.sqrt(_.x)');
  expect(complex.code).toContain('_SYS.csqrt(({ re: _.x, im: 0 }))');
  expect(real.run!({x:9})).toBe(3);expect(complex.run!({x:9})).toBe(3);
  expect(complex.run!({x:-4})).toEqual({re:0,im:2});
  expect(target.compile(ce.expr(['Add','x','z']),{constantFold:false}).run!({x:2,z:{re:3,im:4}})).toEqual({re:5,im:4});
});
test('branch conversion stays in the selected branch',()=>{
  const {ce,target}=setup();
  const result=target.compile(ce.expr(['If','C','x','z']),{constantFold:false});
  const reads:string[]=[];
  const values={C:false,get x(){reads.push('x');throw Error('dead branch');},get z(){reads.push('z');return {re:3,im:4};}};
  expect((result.run as unknown as {rawCall:(input:unknown)=>unknown}).rawCall(values)).toEqual({re:3,im:4});expect(reads).not.toContain('x');
  expect(result.run!({C:true,x:2,z:{re:3,im:4}})).toBe(2);
});
test.each(([
  ['Random'], ['List',1,2], ['Multiply','x','y'], ['If','C','x'],
  ['Function',['Add','x',1],'x'], ['Block',['Declare','s',1],['Assign','s',2],'s'],
] as MathJsonExpression[]).map(json=>({json})))('declines unsupported $json',({json})=>{
  const {ce,target}=setup();expect(()=>target.compile(ce.expr(json),{fallback:false})).toThrow(/JS scalar fragment/);
});
test('legacy seeded lazy Random remains unchanged',()=>{
  const {ce,target}=setup();const expr=ce.expr(['If','C',['Random'],['Add',['Random'],['Random']]]);
  expect(()=>target.compile(expr,{fallback:false})).toThrow(/JS scalar fragment/);
  for(const C of [false,true]){
    const result=compile(expr,{fallback:false});
    const sample=(f:()=>unknown)=>withRandomSeedFrame(ce,42,()=>[f(),ce._random()]);
    expect(sample(()=>result.run!({C}))).toEqual(sample(()=>expr.subs({C}).N().re));
  }
});
test('unsupported input and host policy decline',()=>{
  const {ce,target}=setup();ce.assign('a',-4);
  for(const json of ['a','u'] as MathJsonExpression[])expect(()=>target.compile(ce.expr(json),{fallback:false})).toThrow(/JS scalar fragment/);
  expect(()=>target.compile(ce.expr('x'),{functions:{Sqrt:'Math.sqrt'}})).toThrow(/unsupported compile options/);
  expect(()=>target.compile(ce.expr('x'),{mode:'bigint'})).toThrow(/unsupported compile options/);
});
test('missing or foreign prepared facts fail closed',()=>{
  const {ce}=setup();const root=ce.expr('x');const other=ce.expr('y');
  const target={rootExpression:root} as CompileTarget<Expression>;
  attachScalarFragment(target,{root,annotate:()=>({root,scope:{bindings:new Map(),facts:new Map([[root,{type:{kind:'real'},representation:'number'}]]),inner:new Map()},functions:new Map()})});
  const leave=enterScalarFragment(root,target);leave!();
  expect(()=>enterScalarFragment(other,target)).toThrow(/missing prepared-node facts/);
  expect(()=>enterScalarFragment(root,{...target,rootExpression:other})).toThrow(/different prepared policy/);
  expect(()=>enterScalarFragment(root,{...target,mode:'complex'})).toThrow(/different prepared policy/);
  expect(()=>enterScalarFragment(root,{...target,constantFold:false})).toThrow(/different prepared policy/);
});

for (const constantFold of [false, true]) {
  test(`structural negative radical, fold=${constantFold}`, () => {
    const { ce, target } = setup();
    const expression = ce.expr(['Sqrt', -4], { form: 'structural' });
    expect(target.compile(expression, { constantFold }).run!({}))
      .toEqual({ re: 0, im: 2 });
  });
}

test('complex-input numeric fixtures have independent exact values', () => {
  const { ce, target } = setup();
  const input = { x: 2, z: { re: 3, im: 4 } };
  expect(target.compile(ce.expr(['Negate', 'z'])).run!(input))
    .toEqual({ re: -3, im: -4 });
  expect(target.compile(ce.expr(['Sqrt', 'z'])).run!(input))
    .toEqual({ re: 2, im: 1 });
});
