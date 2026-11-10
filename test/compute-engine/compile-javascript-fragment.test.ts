import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { MathJsonExpression } from '../../src/math-json/types';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import { attachScalarFragment, enterScalarFragment, scalarResultIsComplex, scalarOperandIsComplex, scalarConvertOperand } from '../../src/compute-engine/compilation/javascript-fragment-facts';
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
  [['Random'], /unsupported head Random/], [['List',1,2], /unsupported head List/],
  [['Multiply','x','y'], /unsupported head Multiply/], [['If','C','x'], /unsupported arity/],
  [['Function',['Add','x',1],'x'], /explicit distinct scalar parameters required/],
  [['Block',['Declare','s',"'real'",1],['Assign','s',2],'s'], /unsupported head Block/],
] as [MathJsonExpression, RegExp][]).map(([json,reason])=>({json,reason})))('declines unsupported $json',({json,reason})=>{
  const {ce,target}=setup();const expr=ce.expr(json);
  // A valid program, so that the decline comes from the fragment checks.
  expect(expr.isValid).toBe(true);
  expect(()=>target.compile(expr,{fallback:false})).toThrow(reason);
});
test('legacy seeded lazy Random remains unchanged',()=>{
  const {ce,target}=setup();const expr=ce.expr(['If','C',['Random'],['Add',['Random'],['Random']]]);
  expect(()=>target.compile(expr,{fallback:false})).toThrow(/unsupported head Random/);
  for(const C of [false,true]){
    const result=compile(expr,{fallback:false});
    const sample=(f:()=>unknown)=>withRandomSeedFrame(ce,42,()=>[f(),ce._random()]);
    expect(sample(()=>result.run!({C}))).toEqual(sample(()=>expr.subs({C}).N().re));
  }
});
test('unsupported input and host policy decline',()=>{
  const {ce,target}=setup();ce.assign('a',-4);
  for(const json of ['a','u'] as MathJsonExpression[])expect(()=>target.compile(ce.expr(json),{fallback:false})).toThrow(new RegExp(`unsupported binding ${json}`));
  expect(()=>target.compile(ce.expr('x'),{functions:{Sqrt:'Math.sqrt'}})).toThrow(/unsupported compile options/);
  expect(()=>target.compile(ce.expr('x'),{mode:'bigint'})).toThrow(/unsupported compile options/);
});
test('missing or foreign prepared facts fail closed',()=>{
  const {ce}=setup();const root=ce.expr('x');const other=ce.expr('y');
  const target={rootExpression:root} as CompileTarget<Expression>;
  attachScalarFragment(target,{root,annotation:{root,scope:{bindings:new Map(),facts:new Map([[root,{type:{kind:'real'},representation:'number'}]]),inner:new Map()},functions:new Map()}});
  const leave=enterScalarFragment(root,target);leave!();
  expect(()=>enterScalarFragment(other,target)).toThrow(/missing prepared-node facts/);
  expect(()=>enterScalarFragment(root,{...target,rootExpression:other})).toThrow(/different prepared policy/);
  expect(()=>enterScalarFragment(root,{...target,mode:'complex'})).toThrow(/different prepared policy/);
  expect(()=>enterScalarFragment(root,{...target,constantFold:false})).toThrow(/different prepared policy/);
});

/** A target with an attached artifact whose root `x` has the given facts. */
function factsFixture(rootFacts:Record<string,unknown>, annotatedRoot?:Expression){
  const {ce}=setup();const root=ce.expr('x');
  const target={rootExpression:root} as CompileTarget<Expression>;
  attachScalarFragment(target,{root,annotation:{root:annotatedRoot??root,scope:{bindings:new Map(),facts:new Map([[root,{type:{kind:'real'},representation:'number',...rootFacts}]]),inner:new Map()},functions:new Map()}});
  return {ce,root,target};
}
test('an annotation of another root fails closed',()=>{
  const {ce,root,target}=factsFixture({},undefined);
  // The annotation is checked when it is attached, before any emission.
  expect(()=>factsFixture({},ce.expr('y'))).toThrow(/invalid annotation/);
  enterScalarFragment(root,target)!();
});
test('an operation query outside an entered node fails closed',()=>{
  const {target}=factsFixture({});
  expect(()=>scalarResultIsComplex(target)).toThrow(/no current operation/);
  expect(()=>scalarOperandIsComplex(0,target)).toThrow(/no current operation/);
});
test('an operand query needs the recorded conversion of that operand',()=>{
  const {root,target}=factsFixture({conversions:[{kind:'none',representation:'number'}]});
  const leave=enterScalarFragment(root,target)!;
  expect(scalarOperandIsComplex(0,target)).toBe(false);
  expect(scalarConvertOperand(0,'a',target)).toBe('a');
  expect(()=>scalarOperandIsComplex(1,target)).toThrow(/missing operand conversion/);
  expect(()=>scalarConvertOperand(1,'a',target)).toThrow(/missing operand conversion/);
  leave();
});
test('an operand conversion other than none or real-to-complex fails closed',()=>{
  const {root,target}=factsFixture({conversions:[{kind:'real-to-complex',representation:'complex'},{kind:'complex-to-real',representation:'number'}]});
  const leave=enterScalarFragment(root,target)!;
  expect(scalarConvertOperand(0,'a',target)).toBe('({ re: a, im: 0 })');
  expect(()=>scalarConvertOperand(1,'a',target)).toThrow(/unsupported conversion/);
  leave();
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
