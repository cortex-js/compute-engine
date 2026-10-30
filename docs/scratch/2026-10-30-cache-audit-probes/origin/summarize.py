import json,re,sys
for line in open(sys.argv[1]):
    line=line.strip()
    if line.startswith('=='): print(line); continue
    m=re.match(r'\s*\d+\s+(\{.*)',line)
    if m:
        s=m.group(1)
        g=lambda k: re.search(r'"%s":("[^"]*"|\[[^\]]*\]|[^,]*)'%k,s).group(1)
        print('  ',g('probe'),g('off'),g('medianMs'),g('timesMs'),g('digest'),g('stableDigest'))
    else: print('  ?',line[:120])
