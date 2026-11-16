import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeEngine } from '../../src/compute-engine.ts';
import { BigDecimal } from '../../src/big-decimal/index.ts';
import { prepareBatch } from '../../src/compute-engine/experimental/stable-batch.ts';
function fixture() {
  const ce = new ComputeEngine(); ce.jit = 'off'; ce.precision = 50;
  const unit = prepareBatch(ce, [
    {kind:'slot',name:'x',type:'real',initializer:1001},
    {kind:'slot',name:'z',type:'real',initializer:0},
    {kind:'expression',name:'answer',body:['Add',['Multiply','x',1003],7]},
    {kind:'expression',name:'other',body:['Add',['Multiply','x',1009],11]},
    {kind:'expression',name:'list',body:['List','x',7]},
  ]).unit;
  const instance = unit.instantiate().instance;
  const handle = unit.resolve('answer').handle;
  return {ce,unit,instance,handle,read:(numericApproximation=false)=>instance.evaluateHandle(handle,{numericApproximation}).value};
}
test('one result is reused, refused writes preserve it, every accepted write clears it',()=>{
  const {instance,read}=fixture();
  const first=read(); assert.strictEqual(read(),first);
  assert.equal(instance.write('x',{str:'bad'}).accepted,false); assert.strictEqual(read(),first);
  assert.equal(instance.write('missing',2).status,'unsupported'); assert.strictEqual(read(),first);
  instance.write('z',1); const unrelated=read(); assert.notStrictEqual(unrelated,first); assert.equal(unrelated.re,first.re);
  instance.write('x',1002); assert.equal(read().re,1002*1003+7);
  instance.initialize(); assert.equal(read().re,1001*1003+7);
});
test('single record is replaced by another entry and aggregate results are never stored',()=>{
  const {instance,unit,read}=fixture(); const first=read();
  instance.evaluateHandle(unit.resolve('other').handle);
  assert.notStrictEqual(read(),first);
  const next=read(); instance.evaluateHandle(unit.resolve('list').handle);
  assert.notStrictEqual(read(),next);
  assert.equal(Object.keys(instance).filter(key=>key==='cached').length,1);
});
test('exact and N modes and independent instances never share result records',()=>{
  const {unit,read}=fixture(); const exact=read(); const approximate=read(true);
  assert.notStrictEqual(approximate,exact); assert.strictEqual(read(true),approximate); assert.notStrictEqual(read(),exact);
  assert.notStrictEqual(unit.instantiate().instance.evaluateHandle(unit.resolve('answer').handle).value,read());
});
test('numeric and immutable effect contexts replace cached results',()=>{
  const {ce,read}=fixture();
  const changes=[()=>{ce.precision=60},()=>{BigDecimal.precision=61},()=>{ce._requestedPrecision=42},()=>{ce.tolerance=1e-8},()=>{ce.roundingTies='to-even'},()=>{ce.angularUnit='deg'},()=>{ce.strict=false},()=>{ce.effects={entropy:null}}];
  const oldWorking=BigDecimal.precision;
  try { for(const change of changes){const before=read();change();const after=read();assert.notStrictEqual(after,before);assert.strictEqual(read(),after);} }
  finally {BigDecimal.precision=oldWorking;}
});
test('transient configuration bypasses and drops a working-context result',()=>{
  const {ce,read}=fixture(); const before=read();
  ce._withTransientPrecision(70,()=>{const transient=read();assert.notStrictEqual(transient,before);assert.notStrictEqual(read(),transient);});
  assert.notStrictEqual(read(),before);
});

test('failed initialization and unsupported values leave no memoized record',()=>{
  const ce=new ComputeEngine(); ce.jit='off';
  const prepared=prepareBatch(ce,[{kind:'slot',name:'x',type:'real'},{kind:'expression',name:'answer',body:['Add','x',1001]},{kind:'expression',name:'view',body:['Range',1,3]}]);
  const instance=prepared.unit.instantiate().instance;
  assert.equal(instance.evaluateHandle(prepared.unit.resolve('answer').handle).diagnostics[0],'uninitialized-value');
  assert.equal(instance.cached,undefined);
  assert.equal(instance.evaluateHandle(prepared.unit.resolve('view').handle).status,'unsupported');
  assert.equal(instance.cached,undefined);
});
