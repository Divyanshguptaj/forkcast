import fs from 'node:fs';
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) { const m=l.match(/^([A-Z_]+)=(.*)$/); if(m) process.env[m[1]]=m[2]; }
const G=process.env.GOOGLE_PLACES_API_KEY, GM=process.env.GEMINI_API_KEY, T=process.env.TAVILY_API_KEY;
const j=async(r)=>{const t=await r.text();try{return {s:r.status,b:JSON.parse(t)}}catch{return {s:r.status,b:t.slice(0,300)}}};
const out={};

// 1. Places
const fm=['places.id','places.displayName','places.formattedAddress','places.rating','places.userRatingCount','places.priceLevel','places.websiteUri','places.googleMapsUri','places.servesVegetarianFood','places.regularOpeningHours','places.reviews'].join(',');
const p=await j(await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':G,'X-Goog-FieldMask':fm},body:JSON.stringify({textQuery:'vegetarian restaurants in Barcelona',includedType:'restaurant',pageSize:8,languageCode:'en'})}));
console.log('PLACES status',p.s);
const places=p.b.places||[]; if(!places.length) console.log(JSON.stringify(p.b).slice(0,500));
for(const x of places) console.log('-',x.displayName?.text,'| rating',x.rating,x.userRatingCount,'| price',x.priceLevel,'| web',x.websiteUri||'NONE','| reviews',x.reviews?.length,'| vegFood',x.servesVegetarianFood);
if(places[0]?.reviews?.[0]) console.log('sample review keys',Object.keys(places[0].reviews[0]), places[0].reviews[0].text?.text?.slice(0,120));

// 2. Tavily
const tv=async(path,body)=>j(await fetch('https://api.tavily.com/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify(body)}));
const menus=[];
for(const x of places.filter(x=>x.websiteUri).slice(0,6)){
  const name=x.displayName.text;
  const s=await tv('search',{query:`${name} Barcelona carta menú`,max_results:5,include_raw_content:false});
  const urls=(s.b.results||[]).map(r=>r.url);
  const host=new URL(x.websiteUri).hostname.replace(/^www\./,'');
  const own=urls.find(u=>u.includes(host)&&/carta|menu|menú|men[uú]s|food/i.test(u))||urls.find(u=>u.includes(host));
  let ex=null;
  if(own){const e=await tv('extract',{urls:[own]}); ex=e.b.results?.[0]?.raw_content; if(!ex) ex='('+JSON.stringify(e.b).slice(0,120)+')';}
  console.log(`TAVILY ${name}: search ${s.s}, results ${urls.length}, menuUrl ${own||'NONE'}, extractedChars ${ex?.length||0}`);
  if(ex&&ex.length>300) menus.push({name,url:own,text:ex});
}
// 3. Gemini
const gm=await j(await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':GM}}));
console.log('GEMINI list status',gm.s, typeof gm.b==='string'?gm.b:'');
const names=(gm.b.models||[]).map(m=>m.name.replace('models/','')).filter(n=>/flash/.test(n));
console.log('flash models',names.slice(0,15).join(', '));
const model=names.find(n=>/^gemini-2\.5-flash$/.test(n))||names.find(n=>/^gemini-.*flash$/.test(n))||names[0];
console.log('using',model);
const gen=async(body)=>j(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GM},body:JSON.stringify(body)}));
const sample=menus[0]?.text.slice(0,6000) ?? 'Pa amb tomàquet 4,50\nEscalivada amb formatge de cabra 9,80\nCroquetes de pernil 8,00\nSuquet de peix 18,50\nCrema catalana 5,50';
const schema={type:'ARRAY',items:{type:'OBJECT',properties:{originalName:{type:'STRING'},translatedName:{type:'STRING'},price:{type:'NUMBER',nullable:true},diet:{type:'STRING',enum:['confirmed_vegetarian','likely_vegetarian','unknown','contains_meat_or_fish']},evidence:{type:'STRING'}},required:['originalName','translatedName','diet','evidence']}};
const g1=await gen({contents:[{parts:[{text:'Extract up to 12 dishes from this menu text. Copy originalName and price verbatim; price null if not printed. Translate to English. Classify vegetarian status conservatively.\n<DATA>\n'+sample+'\n</DATA>'}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0}});
console.log('GEMINI structured status',g1.s, menus[0]?'(real menu: '+menus[0].name+')':'(fixture)');
console.log(JSON.stringify(g1.b.candidates?.[0]?.content?.parts?.[0]?.text||g1.b).slice(0,1500));
const g2=await gen({contents:[{parts:[{text:'Find the menu page for Can Culleretes in Barcelona. Use the tool.'}]}],tools:[{functionDeclarations:[{name:'web_search',description:'Search the web',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}}]}]});
console.log('GEMINI function-call status',g2.s, JSON.stringify(g2.b.candidates?.[0]?.content?.parts?.[0]||g2.b).slice(0,300));
const g3=await gen({contents:[{parts:[{text:'Return the city name as JSON, then call the tool if needed. City: Barcelona'}]}],tools:[{functionDeclarations:[{name:'web_search',description:'Search',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}}]}],generationConfig:{responseMimeType:'application/json'}});
console.log('GEMINI function+JSON-mode combined status',g3.s, JSON.stringify(g3.b).slice(0,250));
