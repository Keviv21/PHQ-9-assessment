"""Read local sample PDFs; preserve evidence and recover unambiguous selected cells.
Requires pymupdf in an isolated Python environment. Never opens a database or URL.
"""
import json,re,sys,pathlib,hashlib,difflib
import pymupdf as fitz
inventory=json.load(open(sys.argv[1]));library=json.load(open(sys.argv[2]));out=pathlib.Path(sys.argv[3]);out.mkdir(exist_ok=True)
defs={d['id']:d for d in library['records']}
def norm(t):return re.sub(r'[^a-z0-9]','',t.lower())
def mid(s):return (s['bbox'][1]+s['bbox'][3])/2
results=[]
for r in inventory:
 d=defs[r['id']];evidence={'assessmentId':d['id'],'title':d['title'],'documents':r['documents'],'answers':{},'answerEvidence':[],'answerIssues':[],'sampleRows':[],'pages':[],'graphText':[],'scoringText':[]}
 for docinfo in r['documents']:
  if not docinfo.get('textFile'):continue
  doc=fitz.open(docinfo['archive_path']);response_started=False;scoring_started=False
  textpages=pathlib.Path(docinfo['textFile']).read_text().split('\f')
  for pi,page in enumerate(doc):
   spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] if s['text'].strip()]
   text=textpages[pi] if pi<len(textpages) else page.get_text()
   if re.search(r'(?:Client|Item|Individual) Responses',text,re.I):response_started=True
   headings=[s['text'].strip() for s in spans if s['size']>=10 and ('bold' in s['font'].lower()) and s['bbox'][1]>135 and not re.search(r'Page \d|Generic Client|Client Name',s['text'])]
   evidence['pages'].append({'page':pi+1,'documentSha256':docinfo['sha256'],'headings':headings,'text':text})
   if re.search(r'Scoring and Interpretation Information',text,re.I):scoring_started=True
   if scoring_started:evidence['scoringText'].append({'page':pi+1,'text':re.split(r'Client Responses',text)[0]})
   # Explicit result rows retain all columns; no percentile algorithm inferred from one example.
   front=re.split(r'Client Responses|Scoring and Interpretation Information',text,flags=re.I)[0]
   for li,line in enumerate(front.splitlines()):
    if not re.search(r'\S\s{3,}[-+]?\d+(?:\.\d+)?(?:\s|$)',line) or re.search(r'Client Name|Date of birth|Date administered|Assessor|Time taken|Page \d|^\s*\d',line,re.I):continue
    cells=[c.strip() for c in re.split(r'\s{2,}',line.strip())]
    if len(cells)>1 and re.fullmatch(r'[-+]?\d+(?:\.\d+)?',cells[1]):evidence['sampleRows'].append({'label':cells[0],'rawValue':float(cells[1]),'cells':cells,'page':pi+1,'line':li+1})
   if not response_started:
    # Graph-facing labels, captured separately from interpretation paragraphs.
    graphs=[s['text'].strip() for s in spans if s['bbox'][1]>135 and ('bold' in s['font'].lower() or s['size']>=10) and re.search(r'score|percentile|distribution|subscale|profile|endorsed|average|severity',s['text'],re.I)]
    evidence['graphText'].extend({'page':pi+1,'label':g} for g in graphs)
    continue
   drawings=page.get_drawings()
   numeric=[s for s in spans if re.fullmatch(r'-?\d+(?:\.\d+)?',s['text'].strip())]
   for selected in [s for s in numeric if s['color']==0xffffff and s['bbox'][0]>180]:
    nums=[s for s in numeric if s['bbox'][0]<100 and abs(mid(s)-mid(selected))<8 and re.fullmatch(r'\d+',s['text'])]
    if len(nums)!=1:continue
    ordinal=int(nums[0]['text']);qs=[q for q in d['questions'] if q['order']==ordinal]
    if len(qs)!=1:continue
    q=qs[0]
    options=sorted([s for s in numeric if s['bbox'][0]>180 and abs(mid(s)-mid(selected))<2],key=lambda s:s['bbox'][0])
    if not q['options'] or len(options)!=len(q['options']):
     evidence['answerIssues'].append({'item':q['id'],'page':pi+1,'issue':'Response column count differs from runtime options','pdfColumns':len(options),'runtimeOptions':len(q['options'])});continue
    index=next((i for i,s in enumerate(options) if s is selected),None)
    if index is None:continue
    # Recover the complete question text from the selected cell's row rectangle.
    centre=fitz.Point((selected['bbox'][0]+selected['bbox'][2])/2,mid(selected));rects=[g['rect'] for g in drawings if g['fill'] and g['rect'].contains(centre) and g['rect'].width>10 and g['rect'].height>10]
    rect=min(rects,key=lambda z:z.width*z.height) if rects else fitz.Rect(0,mid(selected)-14,page.rect.width,mid(selected)+14)
    question=' '.join(s['text'] for s in spans if s['bbox'][0]>nums[0]['bbox'][2]+2 and s['bbox'][0]<options[0]['bbox'][0]-12 and rect.y0<=mid(s)<=rect.y1)
    similarity=1.0 if len(norm(q['text']))>=20 and norm(q['text']) in norm(question) else difflib.SequenceMatcher(None,norm(question),norm(q['text'])).ratio()
    if similarity<.68:
     evidence['answerIssues'].append({'item':q['id'],'page':pi+1,'issue':'Question text differs','similarity':round(similarity,3),'sampleText':question});continue
    answer=q['options'][index]['id']
    if q['responseType']=='multiple_choice':answer=[answer]
    if q['id'] in evidence['answers'] and evidence['answers'][q['id']]!=answer:
     evidence['answerIssues'].append({'item':q['id'],'issue':'Multiple highlighted selections; not automatically resolved'});evidence['answers'].pop(q['id'],None);continue
    evidence['answers'][q['id']]=answer
    evidence['answerEvidence'].append({'itemId':q['id'],'page':pi+1,'columnIndex':index,'highlightedText':selected['text'],'questionText':question,'textSimilarity':round(similarity,3),'sourceSha256':docinfo['sha256']})

   # Vertical response lists use bold-italic type to mark the selected option.
   for selected in [s for s in spans if 'bold' in s['font'].lower() and ('oblique' in s['font'].lower() or 'italic' in s['font'].lower()) and re.match(r'^-?\d+(?:\.\d+)?\s{2,}',s['text'])]:
    previous=[s for s in numeric if s['bbox'][0]<100 and s['bbox'][0]<selected['bbox'][0]-4 and mid(s)<mid(selected) and re.fullmatch(r'\d+',s['text'])]
    if not previous:continue
    ordinal=max(previous,key=mid);qs=[q for q in d['questions'] if q['order']==int(ordinal['text'])]
    if len(qs)!=1:continue
    q=qs[0];candidate=re.sub(r'^-?\d+(?:\.\d+)?\s+','',selected['text']).strip()
    exact=[o for o in q['options'] if norm(candidate)==norm(o['text'])]
    matches=exact or [o for o in q['options'] if difflib.SequenceMatcher(None,norm(candidate),norm(o['text'])).ratio()>=.88]
    if len(matches)!=1:
     evidence['answerIssues'].append({'item':q['id'],'page':pi+1,'issue':'Vertical selected option text could not be mapped uniquely','sampleText':candidate});continue
    answer=matches[0]['id']
    if q['responseType']=='multiple_choice':answer=[answer]
    if q['id'] in evidence['answers']:continue
    evidence['answers'][q['id']]=answer
    evidence['answerEvidence'].append({'itemId':q['id'],'page':pi+1,'method':'bold_italic_selected_option','selectedOptionText':candidate,'sourceSha256':docinfo['sha256']})
 evidence['questionCount']=len(d['questions']);evidence['recoveredAnswers']=len(evidence['answers'])
 (out/(d['id']+'.json')).write_text(json.dumps(evidence,indent=2));results.append({'id':d['id'],'questions':len(d['questions']),'recovered':len(evidence['answers']),'sampleRows':len(evidence['sampleRows']),'issues':len(evidence['answerIssues'])})
 if len(results)%25==0:print('Extracted',len(results),flush=True)
(out/'summary.json').write_text(json.dumps(results,indent=2))
print('Complete answer sets:',sum(r['questions']>0 and r['questions']==r['recovered'] for r in results))
