import fs from 'node:fs';
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) { const m=l.match(/^([A-Z_]+)=(.*)$/); if(m) process.env[m[1]]=m[2]; }
const schema={type:'ARRAY',items:{type:'OBJECT',properties:{originalName:{type:'STRING'},translatedName:{type:'STRING'},price:{type:'NUMBER',nullable:true},diet:{type:'STRING',enum:['confirmed_vegetarian','likely_vegetarian','unknown','contains_meat_or_fish']},evidence:{type:'STRING'}},required:['originalName','translatedName','diet','evidence']}};
const sample='Pa amb tomàquet 4,50\nEscalivada amb formatge de cabra 9,80\nCroquetes de pernil 8,00\nSuquet de peix 18,50\nCrema catalana 5,50\nTortilla de patatas con cebolla 7,20\nEnsalada de la casa (con anchoas) 9,00';
for (const model of ['gemini-2.5-flash','gemini-3.5-flash','gemini-2.5-flash-lite']) {
  const t0=Date.now();
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:'Extract dishes. Copy originalName and price verbatim (null if absent). Translate to English. Classify vegetarian status conservatively.\n<DATA>\n'+sample+'\n</DATA>'}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0}})});
  const b=await r.json();
  console.log(model,r.status,Date.now()-t0+'ms');
  if(r.ok){console.log(JSON.parse(b.candidates[0].content.parts[0].text).map(d=>`${d.originalName} -> ${d.translatedName} | ${d.price} | ${d.diet}`).join('\n'));break;} else console.log(b.error?.message);
}
