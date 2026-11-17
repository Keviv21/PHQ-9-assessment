"""Generate native editable Excalidraw shapes and a matching standalone SVG.

Run from any directory: python3 scripts/docs/generate-workflow.py
No external dependencies, patient records or credentials are used.
"""
from pathlib import Path
from html import escape
import json
import math
import textwrap

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs' / 'diagrams'
OUT.mkdir(parents=True, exist_ok=True)
WIDTH, HEIGHT = 2400, 2000
INK = '#21364d'
BLUE = '#1378c5'
PURPLE = '#7759b5'
GREEN = '#24856c'
AMBER = '#ae7124'
MUTED = '#61758c'
elements, svg = [], []
ids = 0


def shape(kind, x, y, w, h, fill='transparent', stroke=INK, group=None, **extra):
    global ids
    ids += 1
    item = dict(id=f'element-{ids:04}', type=kind, x=x, y=y, width=w, height=h,
                angle=0, strokeColor=stroke, backgroundColor=fill, fillStyle='solid',
                strokeWidth=1.5, strokeStyle='solid', roughness=0, opacity=100,
                groupIds=[group] if group else [], frameId=None,
                roundness={'type': 3} if kind=='rectangle' else None,
                seed=ids*827, version=1, versionNonce=ids*137,
                isDeleted=False, boundElements=[], updated=1, link=None, locked=False)
    item.update(extra)
    elements.append(item)
    return item


def rect(x,y,w,h,fill='#ffffff',stroke='#dce6f1',group=None,radius=18):
    item=shape('rectangle',x,y,w,h,fill,stroke,group)
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    return item


def ellipse(x,y,w,h,fill='transparent',stroke=INK,group=None):
    item=shape('ellipse',x,y,w,h,fill,stroke,group)
    svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    return item


def text(x,y,value,size=20,color=INK,width=600,group=None):
    # Fixed manual line wrapping is preserved in both native and SVG text.
    lines=value.split('\n')
    height=len(lines)*size*1.3
    item=shape('text',x,y,width,height,'transparent',color,group,
               text=value,originalText=value,fontSize=size,fontFamily=2,
               textAlign='left',verticalAlign='top',containerId=None,
               autoResize=False,lineHeight=1.3)
    spans=''.join(f'<tspan x="{x}" dy="{0 if i==0 else size*1.3}">{escape(line)}</tspan>' for i,line in enumerate(lines))
    svg.append(f'<text x="{x}" y="{y+size}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" fill="{color}">{spans}</text>')
    return item


def line(points,color=MUTED,arrow=False,dashed=False,start=None,end=None,group=None):
    x,y=points[0]
    relative=[[px-x,py-y] for px,py in points]
    item=shape('arrow' if arrow else 'line',x,y,max(p[0] for p in points)-min(p[0] for p in points),
               max(p[1] for p in points)-min(p[1] for p in points),'transparent',color,group,
               points=relative,lastCommittedPoint=None,startArrowhead=None,
               endArrowhead='arrow' if arrow else None,
               startBinding={'elementId':start['id'],'focus':0,'gap':12} if start else None,
               endBinding={'elementId':end['id'],'focus':0,'gap':12} if end else None,
               elbowed=False,strokeStyle='dashed' if dashed else 'solid',strokeWidth=2)
    for bound in [start,end]:
        if bound:bound['boundElements'].append({'id':item['id'],'type':'arrow'})
    pts=' '.join(f'{a},{b}' for a,b in points)
    svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'+(' stroke-dasharray="8 7"' if dashed else '')+('/>'))
    if arrow:
        a,b=points[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0]);length=13
        p1=(b[0]-length*math.cos(angle-.45),b[1]-length*math.sin(angle-.45))
        p2=(b[0]-length*math.cos(angle+.45),b[1]-length*math.sin(angle+.45))
        svg.append(f'<path d="M {p1[0]} {p1[1]} L {b[0]} {b[1]} L {p2[0]} {p2[1]}" fill="none" stroke="{color}" stroke-width="2"/>')
    return item


def icon(kind,x,y,color,group):
    if kind=='person':
        ellipse(x+13,y,20,20,'transparent',color,group)
        rect(x+4,y+27,38,27,'transparent',color,group,9)
    elif kind=='document':
        rect(x+5,y,35,48,'transparent',color,group,4)
        for dy in [13,24,35]:line([(x+13,y+dy),(x+33,y+dy)],color,group=group)
    elif kind=='ai':
        rect(x+3,y+10,42,32,'transparent',color,group,8)
        ellipse(x+13,y+21,4,4,color,color,group);ellipse(x+30,y+21,4,4,color,color,group)
        line([(x+24,y),(x+24,y+10)],color,group=group)
        line([(x+16,y+33),(x+32,y+33)],color,group=group)
    elif kind=='check':
        ellipse(x,y,46,46,'transparent',color,group)
        line([(x+10,y+23),(x+20,y+32),(x+36,y+13)],color,group=group)
    elif kind=='chat':
        rect(x,y,46,34,'transparent',color,group,8)
        line([(x+10,y+34),(x+8,y+44),(x+23,y+34)],color,group=group)
        line([(x+11,y+13),(x+35,y+13)],color,group=group)
        line([(x+11,y+23),(x+28,y+23)],color,group=group)
    elif kind=='chart':
        line([(x+2,y),(x+2,y+47),(x+48,y+47)],color,group=group)
        for dx,dy in [(12,29),(25,17),(38,5)]:rect(x+dx,y+dy,7,42-dy,color,color,group,2)
    elif kind=='database':
        rect(x+3,y+10,42,32,'#eaf7f1',color,group,0)
        ellipse(x+3,y+31,42,16,'#eaf7f1',color,group)
        ellipse(x+3,y+2,42,16,'#eaf7f1',color,group)
    elif kind=='decision':
        shape('diamond',x,y,48,48,'transparent',color,group)
        svg.append(f'<polygon points="{x+24},{y} {x+48},{y+24} {x+24},{y+48} {x},{y+24}" fill="none" stroke="{color}" stroke-width="1.5"/>')
    else:icon('document',x,y,color,group)


def card(x,y,w,h,number,title,body,kind='document',tone='blue',footer=None):
    palettes={'blue':(BLUE,'#edf6ff'),'purple':(PURPLE,'#f3effb'),'green':(GREEN,'#edf8f3'),'amber':(AMBER,'#fff7e9')}
    color,fill=palettes[tone];group=f'card-{number}-{x}-{y}'
    box=rect(x,y,w,h,'#ffffff','#dce6f1',group)
    rect(x+20,y+20,66,66,fill,fill,group,14);icon(kind,x+30,y+29,color,group)
    text(x+103,y+20,number,13,color,w-125,group)
    text(x+103,y+43,title,23,INK,w-125,group)
    text(x+24,y+111,body,18,MUTED,w-48,group)
    if footer:text(x+24,y+h-35,footer,15,color,w-48,group)
    return box


def lane(y,h,title,subtitle):
    rect(40,y,2320,h,'#f7f9fc','#e3eaf3',f'lane-{y}',22)
    text(72,y+20,title,19,INK,950)
    text(1020,y+22,subtitle,16,MUTED,1250)


# Header and source preparation.
text(64,30,'Pod Assessment Platform',44,INK,1650)
text(66,92,'From patient history to a completed assessment — clinician decisions, Gemini assistance and saved records',22,MUTED,2200)
text(66,132,'OpenMind workspace  •  Native editable figures  •  Current application flow',15,BLUE,2000)
lane(180,300,'CATALOGUE PREPARATION','Versioned JSON is the source of questionnaire content; it is not a patient database.')
a=card(80,245,650,190,'SOURCE','Assessment JSON','Exact source export, question types, options,\nlimits, conditional rules and provenance.','document')
b=card(875,245,650,190,'IMPORT','Normalize and validate','Preserve canonical IDs and rules. Flag missing\ncontent instead of inventing questions.','check')
c=card(1670,245,650,190,'RUNTIME','Assessment catalogue','186 entries · 181 runnable · 4,927 questions.\nUsed for suggestions, selection and sessions.','document')
line([(742,340),(863,340)],BLUE,True,start=a,end=b)
line([(1537,340),(1658,340)],BLUE,True,start=b,end=c)

# Clinician workflow, left to right.
lane(510,390,'CLINICIAN WORKSPACE  →','Gemini suggests; the clinician chooses. Manual selection remains available.')
a=card(80,580,500,260,'01  /  PATIENT','Select or add a patient','Imported NeuroTwin record + four samples.\nReview the saved clinical history summary.\nNew patient details persist in PostgreSQL.','person',footer='Patient record + history')
b=card(660,580,500,260,'02  /  SUGGEST','Find relevant assessments','History + catalogue → Gemini suggestions.\nReuse the history cache when it matches.\nDoctor conversation or structured review\ncan refine the choice.','ai','purple',footer='Doctor messages stay temporary')
c=card(1240,580,500,260,'03  /  CLINICIAN CHOICE','Review and choose','Leading runnable suggestion is preselected.\nSearch all assessments or choose manually.\nUnavailable content explains what is missing.','decision','amber',footer='Retry or select manually if AI fails')
d=card(1820,580,500,260,'04  /  PRESCRIBE','Confirm the assessment','Link the patient and selected questionnaire.\nSave the prescription, then open the\npatient assessment page.','document',footer='assessment_prescriptions')
for first,second in [(a,b),(b,c),(c,d)]:line([(first['x']+512,710),(second['x']-12,710)],BLUE,True,start=first,end=second)

# Assessment execution snakes back across the next lane.
lane(960,400,'PATIENT ASSESSMENT  ←','Questions and answer labels use the selected language. Clear answers save without repeated confirmation.')
e=card(1820,1030,500,270,'05  /  SESSION SETUP','Language and response mode','Choose from nine languages.\nChat • Voice • On-screen questionnaire.\nValidate complete translations and freeze\nthe session definition, language and mode.','person',footer='Reuse validated translations')
f=card(1240,1030,500,270,'06  /  RESPOND','Question + conversation','Choose an answer, type or speak naturally.\nGemini explains questions and full options.\nAmbiguous answers may need clarification.\nCamera sharing is optional and explicit.','chat','purple',footer='HTTP answers or Gemini Live WebSocket')
g=card(660,1030,500,270,'07  /  VALIDATE + SAVE','Store canonical responses','Check type, choices, limits and conditions.\nClear newly inapplicable answers on edits.\nSave valid answers, revisions and audit.\nInvalid or stale answers are rejected.','check','green',footer='Continue to the next applicable question')
h=card(80,1030,500,270,'08  /  FINAL REVIEW','Review and complete','Review responses and make corrections.\nRequire every applicable answer.\nComplete and protect the saved session.\nWritten feedback is excluded from scoring.','check','green',footer='Current imported forms: responses only')
line([(2070,852),(2070,1018)],BLUE,True,start=d,end=e)
for first,second in [(e,f),(f,g),(g,h)]:line([(first['x']-12,1160),(second['x']+512,1160)],BLUE,True,start=first,end=second)

line([(1050,1312),(1050,1330),(1490,1330),(1490,1312)],GREEN,True,True,start=g,end=f)
text(1090,1337,'Next applicable question',14,GREEN,380)

# Outcomes and the persistence boundary.
lane(1420,480,'RESULTS AND PERSISTENCE','Reports and analytics read saved sessions. No extra reports table is needed.')
out=card(80,1490,500,325,'09  /  FOLLOW-UP','Reports and analytics','View or download the saved report.\nPrint / Save as PDF in the browser.\nInspect response charts and visit history.\n\nHistorical snapshots retain their wording.\nScores appear only when the frozen\ndefinition includes supported scoring.','chart','green')
line([(330,1312),(330,1390),(450,1390),(450,1478)],GREEN,True,start=h,end=out)
dbgroup='postgres-store'
dbbox=rect(720,1515,1000,270,'#edf8f3','#7eb8a6',dbgroup,0)
ellipse(720,1749,1000,72,'#edf8f3','#7eb8a6',dbgroup)
ellipse(720,1479,1000,72,'#edf8f3','#7eb8a6',dbgroup)
text(780,1558,'NEON POSTGRESQL',16,GREEN,850,dbgroup)
text(780,1590,'pod_assessment_platform  /  assessments',25,INK,880,dbgroup)
text(780,1640,'patients  •  assessment_prescriptions  •  assessment_sessions',20,INK,880,dbgroup)
text(780,1680,'assessment_recommendations  •  assessment_translations',20,INK,880,dbgroup)
text(780,1725,'Answers, brief response summaries, revisions, snapshots and caches.',17,MUTED,880,dbgroup)
line([(910,1312),(910,1388),(1220,1388),(1220,1467)],GREEN,True,start=g,end=dbbox)
line([(708,1660),(592,1660)],GREEN,True,start=dbbox,end=out)
card(1820,1490,500,325,'TEMPORARY / NOT SAVED','Conversation boundary','Doctor messages and doctor suggestions\nremain temporary.\n\nFull session transcripts, raw audio and\nvideo are not stored in the database.\nLive voice reaches Gemini while connected;\noptional camera sharing requires opt-in.','chat','amber')
text(80,1850,'Older standard-assessment/draft-review routes are isolated for compatibility; their existing tables and reports are retained.',16,MUTED,2200)
# Legend doubles as a reading guide without adding another flow path.
for x,color,label in [(80,BLUE,'App / clinician action'),(650,PURPLE,'Gemini-assisted step'),(1220,GREEN,'Validated / persisted'),(1810,AMBER,'Decision / retention boundary')]:
    ellipse(x,1940,14,14,color,color);text(x+26,1935,label,17,MUTED,450)

scene={'type':'excalidraw','version':2,'source':'https://excalidraw.com','elements':elements,
       'appState':{'viewBackgroundColor':'#ffffff','gridSize':None,'theme':'light'},'files':{}}
(OUT/'assessment-workflow.excalidraw').write_text(json.dumps(scene,ensure_ascii=False,indent=2)+'\n')
svg_text=f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc"><title id="title">Pod Assessment Platform workflow</title><desc id="desc">Catalogue preparation, clinician recommendations and prescription, multilingual assessment, validation, review, reports and PostgreSQL storage. Doctor conversations and full session media are temporary.</desc><rect width="100%" height="100%" fill="white"/>'+''.join(svg)+'</svg>'
(OUT/'assessment-workflow.svg').write_text(svg_text+'\n')
assert len({e['id'] for e in elements})==len(elements)
assert all(e['width']>=0 and e['height']>=0 for e in elements)
for e in elements:
    for binding in [e.get('startBinding'),e.get('endBinding')]:
        if binding:assert any(n['id']==binding['elementId'] for n in elements)
print(f'Created editable Excalidraw scene ({len(elements)} native objects) and SVG preview.')
