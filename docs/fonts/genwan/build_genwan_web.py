"""Reproducible GenWan Min TC Regular WOFF2 delivery, SIL OFL 1.1.
Requires fonttools[woff] (fontTools + Brotli). No outline changes.
Original font and ui-codepoints.json are explicit inputs, never downloaded by this script.
"""
from fontTools.ttLib import TTFont
from fontTools import subset
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
import argparse, json, hashlib
SOURCE_SHA256='028e19001e7d580f44e145eda751674528b8bb5e421887804469ae3c74fa66a6'
def ranges(points):
 points=sorted(points);out=[]
 if not points:return ''
 a=b=points[0]
 for n in points[1:]:
  if n==b+1:b=n
  else:out.append('U+%X'%a if a==b else 'U+%X-%X'%(a,b));a=b=n
 out.append('U+%X'%a if a==b else 'U+%X-%X'%(a,b))
 return ','.join(out)
def create(job):
 source,outdir,label,filename,points=job;f=TTFont(source,recalcTimestamp=False)
 opt=subset.Options();opt.layout_features=['*'];opt.name_IDs=['*'];opt.name_legacy=True;opt.name_languages=['*'];s=subset.Subsetter(options=opt);s.populate(unicodes=points);s.subset(f)
 family='HGT GenWan Web';values={1:family,2:'Regular',3:'HGT GenWan Web 2.100 '+label,4:family+' Regular',6:'HGTGenWanWeb-Regular',16:family,17:'Regular'}
 for rec in f['name'].names:
  if rec.nameID in values:rec.string=values[rec.nameID].encode(rec.getEncoding(),errors='replace')
 cff=f['CFF '].cff;cff.fontNames=[values[6]];cff.topDictIndex[0].FamilyName=family;cff.topDictIndex[0].FullName=values[4]
 f.flavor='woff2';out=Path(outdir)/filename;f.save(out)
 # The original font's Unicode coverage is partitioned exactly; GSUB glyph closure retained.
 if not set(points).issubset(TTFont(out).getBestCmap()):raise ValueError('Coverage lost: '+filename)
 return {'file':filename,'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'unicodeRange':ranges(points),'codepoints':len(points)}
def main():
 a=argparse.ArgumentParser();a.add_argument('--source',required=True);a.add_argument('--ui-codepoints',required=True);a.add_argument('--output',required=True);args=a.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 if hashlib.sha256(Path(args.source).read_bytes()).hexdigest()!=SOURCE_SHA256:raise ValueError('Unexpected source font hash')
 full=set(TTFont(args.source).getBestCmap());core=set(json.loads(Path(args.ui_codepoints).read_text()))&full
 extra=sorted(full-core);jobs=[(args.source,str(out),'ui','genwan-ui-v1.woff2',sorted(core))]
 jobs.extend((args.source,str(out),'extra %02d'%i,'genwan-extra-%02d-v1.woff2'%i,extra[j:j+512]) for i,j in enumerate(range(0,len(extra),512)))
 with ProcessPoolExecutor(max_workers=2) as pool:results=list(pool.map(create,jobs))
 css='/* Derived from GenWan Min TC Regular 2.100 under OFL 1.1. UI first; remaining glyphs load on demand. */\n'
 whitelist={}
 for r in results:
  url='/assets/fonts/genwan/'+r['file'];whitelist[url]='font/woff2'
  css+="@font-face{font-family:SoupMincho;src:url('"+url+"') format('woff2');font-weight:400;font-style:normal;font-display:swap;unicode-range:"+r['unicodeRange']+'}\n'
 (out.parent/'genwan-fonts.wxss').write_text(css)
 (out.parent/'font-assets-manifest.json').write_text(json.dumps(whitelist,indent=2)+'\n')
 (out.parent/'webfont-manifest.json').write_text(json.dumps({'sourceSha256':SOURCE_SHA256,'coreCount':len(core),'totalCoverage':len(full),'files':results},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'fonts':len(results),'coreBytes':results[0]['bytes'],'totalCoverage':len(full),'extraBytes':sum(r['bytes'] for r in results[1:]),'maxExtra':max(r['bytes'] for r in results[1:])}))
if __name__=='__main__':main()
