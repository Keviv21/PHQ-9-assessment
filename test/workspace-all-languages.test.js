import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES } from '../src/workspace/languages.js';
import { LANGUAGES as browserLanguages } from '../public/workspace-languages.js';
import { usesSelectedLanguage, numericChoicePrompt } from '../public/workspace-language-guard.js';
import { validateTranslation, createTranslationsService } from '../src/workspace/translations.js';
import { SESSION_LABELS } from '../src/workspace/presentation.js';
import { GeminiBridge, systemInstruction } from '../src/workspace/live-bridge.js';
const fixtures = {
 en: { q:'Over the last two weeks, how often have you felt worried?', labels:['Not at all','Several days','More than half the days','Nearly every day'], ui:'Choose your response.', menu:'Choose 0, 1, 2 or 3.' },
 es: { q:'Durante las últimas dos semanas, ¿con qué frecuencia se ha sentido preocupado?', labels:['Nunca','Varios días','Más de la mitad de los días','Casi todos los días'], ui:'Indique su respuesta.', menu:'Seleccione 0, 1, 2 o 3.' },
 hi: { q:'पिछले दो सप्ताह में आपको चिंता कितनी बार हुई?', labels:['बिल्कुल नहीं','कई दिन','आधे से अधिक दिन','लगभग हर दिन'], ui:'अपना उत्तर बताएं।', menu:'०, १, २, ३ में से चुनें।' },
 mr: { q:'मागील दोन आठवड्यांत तुम्हाला किती वेळा चिंता वाटली?', labels:['अजिबात नाही','काही दिवस','अर्ध्यापेक्षा जास्त दिवस','जवळजवळ दररोज'], ui:'तुमचे उत्तर सांगा.', menu:'०, १, २, ३ मधून निवडा.' },
 ta: { q:'கடந்த இரண்டு வாரங்களில் நீங்கள் எவ்வளவு அடிக்கடி கவலையாக உணர்ந்தீர்கள்?', labels:['ஒருபோதும் இல்லை','சில நாட்கள்','பாதிக்கும் மேற்பட்ட நாட்கள்','கிட்டத்தட்ட ஒவ்வொரு நாளும்'], ui:'உங்கள் பதிலைச் சொல்லுங்கள்.', menu:'௦, ௧, ௨, ௩ என்பதைத் தேர்ந்தெடுக்கவும்.' },
 te: { q:'గత రెండు వారాలలో మీరు ఎంత తరచుగా ఆందోళన చెందారు?', labels:['అస్సలు లేదు','కొన్ని రోజులు','సగం కంటే ఎక్కువ రోజులు','దాదాపు ప్రతి రోజు'], ui:'మీ సమాధానం చెప్పండి.', menu:'౦, ౧, ౨, ౩ లో ఎంచుకోండి.' },
 kn: { q:'ಕಳೆದ ಎರಡು ವಾರಗಳಲ್ಲಿ ನೀವು ಎಷ್ಟು ಬಾರಿ ಚಿಂತಿತರಾಗಿದ್ದೀರಿ?', labels:['ಎಂದಿಗೂ ಇಲ್ಲ','ಕೆಲವು ದಿನಗಳು','ಅರ್ಧಕ್ಕಿಂತ ಹೆಚ್ಚು ದಿನಗಳು','ಬಹುತೇಕ ಪ್ರತಿದಿನ'], ui:'ನಿಮ್ಮ ಉತ್ತರವನ್ನು ತಿಳಿಸಿ.', menu:'೦, ೧, ೨, ೩ ಆಯ್ಕೆ ಮಾಡಿ.' },
 ml: { q:'കഴിഞ്ഞ രണ്ടാഴ്ചയിൽ നിങ്ങൾക്ക് എത്ര തവണ ഉത്കണ്ഠ തോന്നി?', labels:['ഒരിക്കലുമില്ല','ചില ദിവസങ്ങളിൽ','പകുതിയിലധികം ദിവസങ്ങളിൽ','മിക്കവാറും എല്ലാ ദിവസവും'], ui:'നിങ്ങളുടെ ഉത്തരം പറയുക.', menu:'൦, ൧, ൨, ൩ തിരഞ്ഞെടുക്കുക.' },
 bn: { q:'গত দুই সপ্তাহে আপনি কতবার উদ্বিগ্ন বোধ করেছেন?', labels:['একেবারেই নয়','কয়েক দিন','অর্ধেকের বেশি দিন','প্রায় প্রতিদিন'], ui:'আপনার উত্তর বলুন।', menu:'০, ১, ২, ৩ বেছে নিন।' },
};
const source = {title:'Synthetic assessment',instructions:fixtures.en.ui,referencePeriod:'Over the last two weeks',
 questions:[{id:'q1',text:fixtures.en.q,options:fixtures.en.labels.map((label,value)=>({value,label}))}],ui:SESSION_LABELS};
function translation(language) {
 const f=fixtures[language];
 return {title:f.ui,instructions:f.ui,referencePeriod:f.q,language,
  questions:[{id:'q1',text:f.q,contextText:'',options:f.labels.map((label,value)=>({value,label}))}],
  ui:Object.fromEntries(Object.entries(SESSION_LABELS).map(([key,value])=>[key,f.ui+' '+(value.match(/\{\w+\}/g)||[]).join(' ')]))};
}
test('Every server and browser selector language has conversation regression coverage',()=>{
 assert.deepEqual(browserLanguages,LANGUAGES);
 assert.deepEqual(Object.keys(fixtures).sort(),LANGUAGES.map(l=>l.code).sort());
});
for(const {code:language,name} of LANGUAGES) {
 test(`${name}: full localized labels, cache repair and wrong-language conversation retry`,async()=>{
  const f=fixtures[language],good=translation(language);
  const other=language==='en'?'es':language==='mr'?'hi':'en';
  assert.ok(usesSelectedLanguage(f.q,language));
  for(const label of f.labels)assert.ok(usesSelectedLanguage(label,language),label);
  assert.equal(usesSelectedLanguage(fixtures[other].q,language),false);
  assert.ok(numericChoicePrompt(f.menu),f.menu);
  assert.equal(numericChoicePrompt(f.q),false);
  assert.doesNotThrow(()=>validateTranslation(source,good,language));
  const bad=structuredClone(good);bad.questions[0].options[1].label='1';
  assert.throws(()=>validateTranslation(source,bad,language));
  let calls=0,saved;
  const wrong=structuredClone(good);wrong.instructions=fixtures[other].ui;
  const service=createTranslationsService({translation:()=>wrong,saveTranslation:(_,__,data)=>saved=data},{
   client:{models:{generateContent:async()=>{calls++;return {text:JSON.stringify(good)};}}},
  });
  const localized=await service.localize(source,language);
  assert.equal(calls,language==='en'?0:1);
  if(language!=='en')assert.equal(saved.language,language);
  const state={language,status:'draft',revision:0,sessionMode:'voice',answers:[null],definition:localized};
  const sent=[],requests=[];
  const bridge=new GeminiBridge({client:{},state,send:m=>sent.push(m)});
  bridge.session={sendClientContent:m=>requests.push(m),close(){}};
  const reply=text=>({serverContent:{outputTranscription:{text},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm',data:'AAAA'}}]},turnComplete:true}});
  await bridge.onMessage(reply(fixtures[other].q));
  assert.equal(requests.length,1);assert.equal(sent.length,0);
  await bridge.onMessage(reply(f.q+' '+f.labels.join('. ')));
  assert.equal(sent.filter(m=>m.type==='audio').length,1);
  const transcript=sent.find(m=>m.type==='transcript');
  for(const label of f.labels)assert.ok(transcript.text.includes(label));
  sent.length=0;
  await bridge.onMessage(reply(f.menu));
  assert.equal(sent.length,0);
  await bridge.onMessage(reply(f.menu));
  assert.ok(!sent.some(m=>m.type==='audio'));
  const fallback=sent.find(m=>m.prepared);assert.ok(fallback);
  for(const label of f.labels)assert.ok(fallback.text.includes(label));
  assert.ok(systemInstruction(localized,language).includes(name));
  bridge.stop();
 });
}
test('Shared Spanish anchors and numeric source scales remain valid; unknown languages fail closed',()=>{
 assert.ok(usesSelectedLanguage('No','es'));
 assert.equal(numericChoicePrompt('Introduzca 0,5 como medida.'),false);
 assert.ok(numericChoicePrompt('Seleccione 0,1,2,3.'));
 assert.equal(usesSelectedLanguage('test','zz'),false);
 const d=structuredClone(source),t=translation('es');
 d.questions[0].options[0].label='No';t.questions[0].options[0].label='No';
 assert.doesNotThrow(()=>validateTranslation(d,t,'es'));
 d.questions[0].options[0].label='0';t.questions[0].options[0].label='0';
 assert.doesNotThrow(()=>validateTranslation(d,t,'es'));
});
