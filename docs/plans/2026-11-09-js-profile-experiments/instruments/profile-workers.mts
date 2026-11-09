import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { writeFileSync, readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { buildKernel, LIST_LENGTH, stepReference } from "./profile-workers-kernel.mts";

const outputPath = process.env.OUTPUT ?? "/tmp/js-profile-next/buddhabrot-workers.json";
const controlsOnly = process.env.CONTROLS_ONLY === "1";
const quick = process.env.QUICK === "1";
const sizes = controlsOnly ? [] : quick ? [101,1000] : [100000,1200000];
const repetitions = quick ? 1 : 3;
const chunks = quick ? [25,100] : [25000,100000];
const loadAtStart = loadavg();
const clients = new Set<Client>();
let requestSequence = 0;
let jobSequence = 0;
let exitedWorkers = 0;

type Reply = { requestId:number; jobId:number; chunkId:number; start:number; count:number; buffer:ArrayBuffer; prepareMs:number; computeMs:number; packMs:number; roundtripMs:number; postMessageMs:number };
class RequestedWorkerTermination extends Error {}
function cancellationOutcome(task:Promise<Reply>) {
  return task.then(()=>"completed",error=>error instanceof RequestedWorkerTermination ? "terminated" : {unexpectedError:String(error)});
}
class Client {
  closeRequested=false;
  unexpectedError?:Error;
  worker: Worker;
  ready: Promise<{setupMs:number;codeHash:string}>;
  startedAt = performance.now();
  readyMs = 0;
  pending = new Map<number,{resolve:(r:Reply)=>void;reject:(e:Error)=>void;started?:()=>void; sentAt:number;postMessageMs:number}>();
  constructor() {
    clients.add(this);
    this.worker = new Worker(new URL("./profile-workers-entry.mjs", import.meta.url), {workerData:{stored:kernel.stored},execArgv:[]});
    this.ready = new Promise((resolve,reject) => {
      this.worker.on("error", (error) => { this.unexpectedError=error; reject(error); for(const p of this.pending.values()) p.reject(error); this.pending.clear(); });
      this.worker.on("message", (message) => {
        if(message.type === "ready") { this.readyMs=performance.now()-this.startedAt; resolve(message); return; }
        const pending=this.pending.get(message.requestId);
        if(!pending) return;
        if(message.type === "started") { pending.started?.(); return; }
        this.pending.delete(message.requestId);
        pending.resolve({...message,roundtripMs:performance.now()-pending.sentAt,postMessageMs:pending.postMessageMs});
      });
      this.worker.on("exit", (code) => {
        clients.delete(this); exitedWorkers++;
        const error=this.unexpectedError ?? (this.closeRequested ? new RequestedWorkerTermination(`requested worker exit ${code}`) : new Error(`unexpected worker exit ${code}`));
        reject(error);
        for(const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      });
    });
  }
  task(jobId:number,chunkId:number,start:number,count:number,options:{delayReplyMs?:number;failForControl?:boolean;onStarted?:()=>void}={}) {
    const requestId=++requestSequence;
    return new Promise<Reply>((resolve,reject)=> {
      const pending={resolve,reject,started:options.onStarted,sentAt:performance.now(),postMessageMs:0};
      this.pending.set(requestId,pending);
      this.worker.postMessage({requestId,jobId,chunkId,start,count,delayReplyMs:options.delayReplyMs,failForControl:options.failForControl});
      pending.postMessageMs=performance.now()-pending.sentAt;
    });
  }
  async close() { this.closeRequested=true; await this.worker.terminate(); }
}

// Publication occurs only after the complete planned set of unique ranges arrives.
class Job {
  readonly id=++jobSequence;
  private partial = Array(LIST_LENGTH).fill(0);
  private received = new Set<number>();
  private active = true;
  published: number[] | null = null;
  duplicates=0;
  stale=0;
  mergeMs=0;
  constructor(readonly initial:number[], readonly ranges:{start:number;count:number}[]) { this.partial=initial.slice(); }
  accept(reply:Reply) {
    if(!this.active || reply.jobId!==this.id) { this.stale++; return false; }
    if(this.received.has(reply.chunkId)) { this.duplicates++; return false; }
    const range=this.ranges[reply.chunkId];
    assert.ok(range);
    assert.equal(reply.start,range.start); assert.equal(reply.count,range.count);
    const values=new Float64Array(reply.buffer);
    assert.equal(values.length,LIST_LENGTH);
    assert.equal(values[90000],range.start+range.count);
    const before=performance.now();
    for(let i=0;i<90000;i++) this.partial[i]+=values[i];
    this.mergeMs+=performance.now()-before;
    this.received.add(reply.chunkId);
    if(this.received.size===this.ranges.length) {
      this.partial[90000]=this.initial[90000]+this.ranges.reduce((n,r)=>n+r.count,0);
      this.published=this.partial;
    }
    return true;
  }
  cancel() { this.active=false; this.partial=[]; }
}
function initialHistogram() { const a=Array(LIST_LENGTH).fill(0); a[0]=7;a[30123]=11;a[89999]=5;a[90000]=137;return a; }
function rangesFor(samples:number,chunk:number) { const ranges=[];for(let offset=0;offset<samples;offset+=chunk) ranges.push({start:137+offset,count:Math.min(chunk,samples-offset)});return ranges; }
async function poolRun(pool:Client[],samples:number,chunk:number) {
  const job=new Job(initialHistogram(),rangesFor(samples,chunk));
  const start=performance.now();
  let next=0;
  const replies: Reply[]=[];
  await Promise.all(pool.map(async(worker)=> {
    while(next<job.ranges.length) {
      const id=next++;
      const r=job.ranges[id];
      const reply=await worker.task(job.id,id,r.start,r.count);
      replies.push(reply);
      job.accept(reply);
    }
  }));
  assert.ok(job.published);
  const wallMs=performance.now()-start;
  const phases = (key:"prepareMs"|"computeMs"|"packMs"|"roundtripMs"|"postMessageMs")=>replies.reduce((n,r)=>n+r[key],0);
  return {values:job.published,stats:{wallMs,mergeMs:job.mergeMs,workerPrepareSumMs:phases("prepareMs"),workerComputeSumMs:phases("computeMs"),workerPackSumMs:phases("packMs"),roundtripSumMs:phases("roundtripMs"),postMessageSumMs:phases("postMessageMs"),chunks:replies.length,resultBytes:replies.length*LIST_LENGTH*8}};
}

const records:unknown[]=[];
const startups:unknown[]=[];
const controls:Record<string,unknown>={};
const kernel=await buildKernel();
try {
  // Independent reference control before any benchmark.
  assert.deepEqual(kernel.run(initialHistogram(),1000),stepReference(initialHistogram(),1000));
  controls.reference1000Exact=true;
  // Build one serial oracle per workload, then warm before timed repetitions.
  const expected=new Map<number,number[]>();
  for(const samples of sizes) {
    const serial=kernel.run(initialHistogram(),samples);
    assert.deepEqual(serial,stepReference(initialHistogram(),samples));
    expected.set(samples,serial);
  }
  controls.independentReferenceWorkloads=sizes;
  kernel.run(initialHistogram(),10000);
  for(const samples of sizes) for(let rep=0;rep<repetitions;rep++) {
    const t=performance.now();const values=kernel.run(initialHistogram(),samples);const wallMs=performance.now()-t;
    assert.deepEqual(values,expected.get(samples));
    records.push({route:"calling-thread",workers:0,samples,chunk:samples,rep,wallMs,exact:true,histogramSum:values.slice(0,90000).reduce((a,b)=>a+b,0),cursor:values[90000]});
  }
  for(const count of (controlsOnly ? [] : [1,2,4])) {
    const start=performance.now();
    const pool=Array.from({length:count},()=>new Client());
    const ready=await Promise.all(pool.map(w=>w.ready));
    ready.forEach(r=>assert.equal(r.codeHash,kernel.codeHash));
    const poolReadyMs=performance.now()-start;
    // First actual result includes cold execution but excludes startup, reported separately.
    const first=await poolRun(pool,sizes[0],Math.ceil(sizes[0]/count));
    assert.deepEqual(first.values,expected.get(sizes[0]));
    startups.push({workers:count,poolReadyMs,workerReadyMs:pool.map(w=>w.readyMs),workerSetupMs:ready.map(r=>r.setupMs),firstJobSamples:sizes[0],firstJob:first.stats});
    await Promise.all(pool.map((w,i)=>w.task(++jobSequence,i,137,10000)));
    for(const samples of sizes) for(const chunk of (count===1?[samples]:chunks)) for(let rep=0;rep<repetitions;rep++) {
      const result=await poolRun(pool,samples,chunk);
      assert.deepEqual(result.values,expected.get(samples));
      records.push({route:count===1?"dedicated-worker":"worker-pool",workers:count,samples,chunk,rep,...result.stats,exact:true});
    }
    await Promise.all(pool.map(w=>w.close()));
  }
  // Actual returned worker buffers exercise duplicate and incomplete publication guards.
  const worker=new Client();await worker.ready;
  const job=new Job(initialHistogram(),rangesFor(101,51));
  const first=await worker.task(job.id,0,137,51);
  assert.equal(job.accept(first),true);assert.equal(job.published,null);
  assert.equal(job.accept(first),false);assert.equal(job.duplicates,1);assert.equal(job.published,null);
  const second=await worker.task(job.id,1,188,50);job.accept(second);
  assert.deepEqual(job.published,kernel.run(initialHistogram(),101));
  controls.duplicateSuppression={duplicates:job.duplicates,exact:true,noPartialPublication:true};
  // Supersede an actual submitted job; an artificial delayed reply makes the race deterministic.
  const old=new Job(initialHistogram(),rangesFor(101,101));
  const oldReply=worker.task(old.id,0,137,101,{delayReplyMs:50});
  old.cancel();
  const replacement=new Job(initialHistogram(),rangesFor(103,103));
  replacement.accept(await worker.task(replacement.id,0,137,103));
  const stale=await oldReply;
  assert.equal(old.accept(stale),false);assert.equal(old.published,null);
  assert.equal(replacement.accept(stale),false);
  assert.deepEqual(replacement.published,kernel.run(initialHistogram(),103));
  controls.supersession={oldPublished:false,staleRejected:old.stale,replacementStaleRejected:replacement.stale,replacementExact:true,replyDelayMs:50};
  await worker.close();
  // Cancellation terminates a worker after request receipt. The receipt signal
  // precedes preparation, so it does not prove execution entered generated code.
  const cancelledWorker=new Client();await cancelledWorker.ready;
  const cancelledJob=new Job(initialHistogram(),rangesFor(20000000,20000000));
  let startedResolve!:()=>void;
  const started=new Promise<void>(resolve=>{startedResolve=resolve;});
  const pending=cancellationOutcome(cancelledWorker.task(cancelledJob.id,0,137,20000000,{onStarted:startedResolve}));
  await started;
  const cancelStart=performance.now();cancelledJob.cancel();await cancelledWorker.close();
  const cancellationMs=performance.now()-cancelStart;
  const outcome=await pending;assert.equal(outcome,"terminated");assert.equal(cancelledJob.published,null);
  controls.cancellation={requestReceived:true,outcome,noPartialPublication:true,...(controlsOnly ? {} : {cancellationToExitMs:cancellationMs})};
  // An actual worker exception must not satisfy the termination control.
  const failingWorker=new Client();await failingWorker.ready;
  const failed=await cancellationOutcome(failingWorker.task(++jobSequence,0,137,1,{failForControl:true}));
  assert.deepEqual(failed,{unexpectedError:"Error: injected worker failure"});
  await failingWorker.close();
  controls.unexpectedWorkerError={notClassifiedAsTermination:true,error:failed};
  assert.equal(clients.size,0);
  const result={environment:{node:process.version,ceVersion:JSON.parse(readFileSync("node_modules/@cortex-js/compute-engine/package.json","utf8")).version,tychoRevision:"8777c57e37e0e7962b7cdca8093f986c7e5cec6c",cpu:cpus()[0].model,cpuCount:cpus().length,loadAtStart,loadAtEnd:loadavg()},method:{quick,repetitions,sizes,chunks,precision:"machine JS number",iterationBudget:"Infinity (no counter); external worker termination in cancellation control",warmup:"serial oracle per workload and 10000 samples; each worker first job then 10000 samples",preludeHash:kernel.preludeHash,codeHash:kernel.codeHash,artifactHash:kernel.artifactHash,runtimeVersion:kernel.stored.runtimeVersion,serialSetupMs:kernel.setupMs,transport:"worker builds private JS input; Float64Array output buffer transferred; no shared histogram"},startups,records,controls,cleanup:{liveOwnedWorkers:clients.size,exitEvents:exitedWorkers},limitations:["Node worker_threads scheduler prototype using public createJavaScriptRuntime().load; not CE kernel-pool or browser integration","Worker startup includes Node runtime import and public stored-code load, not recompilation; not browser bundle startup","Roundtrip includes worker phases, transport and scheduling; phase sums overlap across workers and cannot be subtracted from wall time","postMessage duration is synchronous enqueue cost, not transfer latency","Supersession uses deliberately delayed reply; cancellation uses forced worker termination","No nested worker tree tested; coordinator owns every worker directly"]};
  writeFileSync(outputPath,JSON.stringify(controlsOnly ? {controlsOnly,controls,cleanup:result.cleanup} : result,null,2)+"\n");
  console.log(JSON.stringify({outputPath,records:records.length,controls,cleanup:result.cleanup}));
} finally {
  await Promise.all([...clients].map(w=>w.close()));
}
