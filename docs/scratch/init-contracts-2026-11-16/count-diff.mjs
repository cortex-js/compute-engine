// Reproducible physical and lexical-code changed-line counts. Relocation is
// neutral only after the report identifies and subtracts matching moves.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const base = process.argv[3] ?? 'HEAD';
const ts = createRequire(resolve(root, 'package.json'))('typescript');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8', maxBuffer:64*1024*1024, stdio:['ignore','pipe','pipe']});
function codeLines(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const lines = new Set();
  const starts = [0];
  for (let i=0; i<source.length; i++) if(source[i]==='\n') starts.push(i+1);
  const line = offset => {let lo=0, hi=starts.length; while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid;}return lo+1;};
  for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFileToken;token=scanner.scan()){
    if(token>=ts.SyntaxKind.FirstTriviaToken && token<=ts.SyntaxKind.LastTriviaToken)continue;
    for(let n=line(scanner.getTokenPos());n<=line(scanner.getTextPos()-1);n++)lines.add(n);
  }
  return lines;
}
const paths = new Set(git('diff','--name-only',base).trim().split('\n').filter(Boolean));
for(const p of git('ls-files','--others','--exclude-standard').trim().split('\n')) if(p)paths.add(p);
const rows=[];
for(const path of [...paths].sort()){
  if(!/^(src|test)\//.test(path)||!path.endsWith('.ts'))continue;
  let old='';try{old=git('show',`${base}:${path}`);}catch{}
  let current='';try{current=readFileSync(resolve(root,path),'utf8');}catch{}
  const oldCode=codeLines(old), newCode=codeLines(current);
  let add=0,del=0,codeAdd=0,codeDel=0;
  if(!old){add=current.split('\n').length-(current.endsWith('\n')?1:0);codeAdd=newCode.size;}
  else {
    let a=0,b=0;
    for(const l of git('diff','--no-ext-diff','--no-renames','--unified=0',base,'--',path).split('\n')){
      const h=l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if(h){a=+h[1];b=+h[2];continue;}
      if(l.startsWith('---')||l.startsWith('+++'))continue;
      if(l.startsWith('-')){del++;if(oldCode.has(a))codeDel++;a++;}
      else if(l.startsWith('+')){add++;if(newCode.has(b))codeAdd++;b++;}
    }
  }
  rows.push({path,category:path.startsWith('src/')?'production':'tests',add,del,net:add-del,codeAdd,codeDel,codeNet:codeAdd-codeDel});
}
console.log(JSON.stringify({root,base:git('rev-parse',base).trim(),metric:'physical and lexical token-bearing changed lines; relocation not yet subtracted',rows},null,2));
