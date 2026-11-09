import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out='/tmp/js-contract-browser';mkdirSync(out,{recursive:true});
const entries={'coordinator':'scripts/profile-browser-coordinator.ts','product':'scripts/profile-browser-product.ts','kernel-worker':'/tmp/wt-js-contract/src/kernel-worker.ts'};
for(const [name,entry] of Object.entries(entries))await build({entryPoints:[entry],outfile:`${out}/${name}.js`,bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning',metafile:true}).then(result=>writeFileSync(`${out}/${name}-meta.json`,JSON.stringify(result.metafile)));
let browser;const server=createServer((req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Worker correctness harness</title>');return;}const name=basename(new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type','text/javascript');res.end(readFileSync(`${out}/${name}`));}catch{res.statusCode=404;res.end();}});
try{
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
browser=await chromium.launch({headless:true,args:['--ignore-gpu-blocklist','--use-gl=angle']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(`http://127.0.0.1:${port}`);
const result=await page.evaluate(()=>new Promise((resolve,reject)=>{const w=new Worker('/coordinator.js',{type:'module'});const timer=setTimeout(()=>{w.terminate();reject(Error('coordinator timeout'));},90000);w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.onmessage=e=>{clearTimeout(timer);w.terminate();resolve(e.data);};w.postMessage({type:'run'});}));
writeFileSync(`${out}/browser-result.json`,JSON.stringify(result,null,2));assert.equal(result.ok,true,JSON.stringify(result));
writeFileSync(`${out}/original.epsil`,result.original);writeFileSync(`${out}/parallel.epsil`,result.adapted);
const product=await page.evaluate(source=>new Promise((resolve,reject)=>{const w=new Worker('/product.js',{type:'module'});const messages=[];const timer=setTimeout(()=>{w.terminate();reject(Error('product timeout'));},30000);w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.onmessage=e=>{messages.push(e.data);if(e.data.type==='result'||e.data.type==='failed'){clearTimeout(timer);w.terminate();resolve(messages);}};w.postMessage({type:'check',id:91,source,settings:{angleUnit:'radians',precision:'standard',complexMode:false}});}),result.productSource);
writeFileSync(`${out}/product-result.json`,JSON.stringify(product,null,2));assert.equal(product.at(-1).type,'result');assert.equal(product.at(-1).result.valid,true,JSON.stringify(product));assert.equal(product.at(-1).instrument.asyncRuns,0);assert(product.at(-1).instrument.compiled>0);
const answer=product.at(-1).result.values.find(v=>v.name==='answer');assert(answer,'product answer exists');assert.deepEqual(answer.json,['List',...result.productExpected]);
writeFileSync(`${out}/provenance.json`,JSON.stringify({browser:browser.version(),node:process.version,tycho:'0e6482e1f',ceSource:'916aff07c',installedCE:JSON.parse(readFileSync('node_modules/@cortex-js/compute-engine/package.json')).version,errors,assets:Object.fromEntries(Object.keys(entries).map(n=>[n,createHash('sha256').update(readFileSync(`${out}/${n}.js`)).digest('hex')]))},null,2));assert.deepEqual(errors,[]);
console.log(JSON.stringify({ok:true,rows:result.rows,controls:result.controls,product:{valid:product.at(-1).result.valid,instrument:product.at(-1).instrument},browser:browser.version()}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
