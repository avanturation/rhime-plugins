const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),L=require('../src/core');
const src=fs.readFileSync('src/design.js','utf8'),context={LyricsMotion:L,module:{exports:{}}};vm.runInNewContext(src,context);const D=context.module.exports;
const sample=fs.readFileSync('sample.lrc','utf8'),parsed=L.parse(sample);
function fixture({fail=false}={}){
 const nodes=[],map=new Map();let hasTimeline=false;
 function node(type,id,props={}){const n={type,id,name:id,x:0,y:0,width:440,height:348,opacity:1,visible:true,fills:[],effects:[],clipsContent:false,children:[],manualKeyframeTracks:{},data:{},...props,
 findAll(fn){return this.children.flatMap(n=>(fn(n)?[n]:[]).concat(n.findAll(fn)));},
 getSharedPluginData(ns,k){return this.data[k]||'';},setSharedPluginData(ns,k,v){this.data[k]=v;},
 applyManualKeyframeTrack(field,track){if(fail&&field.collection==='effects')throw new Error('effect failure');hasTimeline=true;if(field.type==='PROPERTY')this.manualKeyframeTracks[field.name]=structuredClone(track);else if(field.collection==='fills'){this.manualKeyframeTracks.fills??={};this.manualKeyframeTracks.fills[field.index]??={properties:{}};this.manualKeyframeTracks.fills[field.index].properties[field.propertyId]=structuredClone(track);}else {this.manualKeyframeTracks.effects??={};this.manualKeyframeTracks.effects[field.index]??={};this.manualKeyframeTracks.effects[field.index][field.field]=structuredClone(track);}},
 removeManualKeyframeTrack(f){if(f.type==='PROPERTY')delete this.manualKeyframeTracks[f.name];else if(f.collection==='fills'){if(this.manualKeyframeTracks.fills?.[f.index])delete this.manualKeyframeTracks.fills[f.index].properties[f.propertyId];}else if(this.manualKeyframeTracks.effects?.[f.index])delete this.manualKeyframeTracks.effects[f.index][f.field];},
 setTimelineDuration(id,v){this.duration=v;},get timelines(){return hasTimeline?[{id:'timeline',duration:this.duration||2}]:[];}};nodes.push(n);map.set(id,n);return n;}
 function child(p,c){p.children.push(c);c.parent=p;return c;}
 const root=node('FRAME','root',{width:440,height:956}),controls=child(root,node('FRAME','controls'));
 child(controls,node('TEXT','title',{characters:'가사',fontSize:16}));
 const viewport=child(root,node('FRAME','viewport',{y:554,height:348,clipsContent:false})),strip=child(viewport,node('FRAME','strip',{x:16,y:16,width:408,height:328,clipsContent:true}));
 const texts=parsed.cues.map((c,i)=>{const row=child(strip,node('FRAME','row'+i,{y:i?40+i*55:0,width:408,height:43}));return child(row,node('TEXT','lyric'+i,{x:4,y:i?4:44,width:400,height:35,fontSize:28,fontName:{family:'Interlude Variable',style:'SemiBold',variationSettings:{wght:600,opsz:14}},lineHeight:{unit:'PIXELS',value:35},characters:c.text,
 fills:[{type:'SOLID',opacity:i?.32:1,color:{r:.98,g:.98,b:.98},boundVariables:{color:{type:'VARIABLE_ALIAS',id:i?'inactive':'base'}}}]}));});
 return {root,strip,viewport,texts,controls,nodes,map};
}
test('existing design matches repeated lyrics once in visual order and preserves native layout',()=>{
 const f=fixture(),d=D.inspect(f.root,parsed,{});assert.equal(d.texts.length,16);assert.equal(d.strip.id,'strip');assert.equal(d.preview.fontSize,28);assert.equal(d.preview.baseY,60);assert.equal(d.plan.rows[1].y,55);assert.equal(d.plan.rows[15].y,825);
});
test('applying creates no nodes and leaves background, controls, text and typography unchanged',()=>{
 const f=fixture(),d=D.inspect(f.root,parsed,{}),before=JSON.stringify(f.controls,(k,v)=>k==='parent'||k==='timelines'?undefined:v),count=f.nodes.length,positions=f.texts.map(n=>[n.x,n.y,n.width,n.height,n.characters,JSON.stringify(n.fontName)]);
 D.apply(d);assert.equal(f.nodes.length,count);assert.equal(JSON.stringify(f.controls,(k,v)=>k==='parent'||k==='timelines'?undefined:v),before);assert.equal(f.root.duration,51.4);
 assert.deepEqual(f.texts.map(n=>[n.x,n.y,n.width,n.height,n.characters,JSON.stringify(n.fontName)]),positions);assert.equal(f.strip.manualKeyframeTracks.TRANSLATION_Y.keyframes.at(-1).value.value,-825);
 assert.equal(f.texts[1].fills[0].opacity,1);assert.equal(f.texts[1].manualKeyframeTracks.OPACITY.keyframes.find(k=>k.timelinePosition===19.16).value.value,1);assert.equal(f.strip.clipsContent,false);assert.equal(f.viewport.clipsContent,true);
});
test('effect failure restores original fills, effects, clipping, opacity and tracks',()=>{
 const f=fixture({fail:true}),before=f.texts.map(n=>JSON.stringify({fills:n.fills,effects:n.effects,opacity:n.opacity}));assert.throws(()=>D.apply(D.inspect(f.root,parsed,{})),/effect failure/);
 assert.deepEqual(f.texts.map(n=>JSON.stringify({fills:n.fills,effects:n.effects,opacity:n.opacity})),before);assert.equal(f.strip.clipsContent,true);assert.equal(f.viewport.clipsContent,false);assert.equal(f.strip.manualKeyframeTracks.TRANSLATION_Y,undefined);assert.equal(f.root.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-target'),'');
});
test('repeated application retains first backup and restore returns original variable bindings',async()=>{
 const f=fixture(),before=JSON.stringify(f.texts.map(n=>n.fills));D.apply(D.inspect(f.root,parsed,{}));D.apply(D.inspect(f.root,parsed,{transition:.3}));await D.restore(f.root,async id=>f.map.get(id));
 assert.equal(JSON.stringify(f.texts.map(n=>n.fills)),before);assert.equal(f.texts[0].effects.length,0);assert.equal(f.strip.clipsContent,true);assert.equal(f.viewport.clipsContent,false);assert.equal(f.strip.manualKeyframeTracks.TRANSLATION_Y,undefined);
});
test('unmatched LRC fails without changing any design',()=>{const f=fixture();f.texts[3].characters='다른 노래';assert.throws(()=>D.inspect(f.root,parsed,{}),/찾지 못/);assert.equal(f.root.data['lyrics-motion-target'],undefined);});
test('main plugin revalidates design geometry before applying and reports target',async()=>{
 const f=fixture(),messages=[],figma={ui:{postMessage:m=>messages.push(m)},currentPage:{selection:[f.root]},viewport:{scrollAndZoomIntoView(){}},getNodeByIdAsync:async id=>f.map.get(id),on(){},showUI(){},notify(){}};
 vm.runInNewContext(fs.readFileSync('src/main.js','utf8'),{LyricsMotion:L,LyricsDesign:D,figma,__html__:''});
 await figma.ui.onmessage({type:'inspect-design',lrc:sample,settings:{}});const target=messages.at(-1);assert.equal(target.lines,16);
 f.texts[0].height=36;await figma.ui.onmessage({type:'apply-existing',nodeId:'root',signature:target.signature,lrc:sample,settings:{}});assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/바뀌었/);
 f.texts[0].height=35;await figma.ui.onmessage({type:'apply-existing',nodeId:'root',signature:target.signature,lrc:sample,settings:{}});assert.equal(messages.at(-1).type,'applied');assert.equal(messages.at(-1).nodeId,'root');
});

 test('progressive blur remains fixed to the viewport when the lyrics scroll, and restores exactly',async()=>{
 const f=fixture(),blur={type:'LAYER_BLUR',radius:12,visible:true,blurType:'PROGRESSIVE',startRadius:0,startOffset:{x:.5,y:.4},endOffset:{x:.5,y:1.2}};f.strip.effects=[blur];
 D.apply(D.inspect(f.root,parsed,{}));assert.equal(f.strip.effects.length,0);assert.equal(f.viewport.effects.length,1);assert.equal(f.viewport.effects[0].radius,12);assert.equal(f.viewport.effects[0].startOffset.x,.5);assert.equal(f.viewport.effects[0].startOffset.y,(16+.4*328)/348);
 D.apply(D.inspect(f.root,parsed,{}));assert.equal(f.viewport.effects.length,1);await D.restore(f.root,async id=>f.map.get(id));assert.deepEqual(JSON.parse(JSON.stringify(f.strip.effects)),[blur]);assert.equal(f.viewport.effects.length,0);
 });
 test('switching a previously applied timeline to first-line timing trims only the generated duration',()=>{const f=fixture();D.apply(D.inspect(f.root,parsed,{}));assert.equal(f.root.duration,51.4);D.apply(D.inspect(f.root,parsed,{fromFirst:true}));assert.equal(f.root.duration,35.03);});
test('in-place adapter passes custom Bézier points to Figma tracks without changing timing or layout',()=>{
 const f=fixture(),b={x1:.22,y1:1,x2:.36,y2:1};D.apply(D.inspect(f.root,parsed,{bezier:b}));
 for(const tr of [f.strip.manualKeyframeTracks.TRANSLATION_Y,f.texts[2].manualKeyframeTracks.OPACITY,f.texts[2].manualKeyframeTracks.effects[0].RADIUS]){
  const k=tr.keyframes.find(k=>k.easing.type==='CUSTOM_CUBIC_BEZIER');assert.deepEqual(k.easing.easingFunctionCubicBezier,b);
 }
 assert.equal(f.root.duration,51.4);assert.equal(f.texts[2].fontSize,28);assert.equal(f.texts[2].characters,parsed.cues[2].text);
});
test('native incoming easing matches the preview outgoing easing on every interval',()=>{
 const f=fixture(),d=D.inspect(f.root,parsed,{bezier:{x1:.22,y1:1,x2:.36,y2:1}});D.apply(d);
 const pairs=[[d.plan.scroll,f.strip.manualKeyframeTracks.TRANSLATION_Y],...d.plan.rows.flatMap((r,i)=>[[r.opacity,f.texts[i].manualKeyframeTracks.OPACITY],[r.blur,f.texts[i].manualKeyframeTracks.effects[0].RADIUS]])];
 for(const [preview,native] of pairs){
  for(let i=1;i<native.keyframes.length;i++)assert.deepEqual(native.keyframes[i].easing,preview.keyframes[i-1].easing);
  assert.deepEqual(native.keyframes.map(k=>[k.timelinePosition,k.value]),preview.keyframes.map(k=>[k.timelinePosition,k.value]));
 }
 const scroll=f.strip.manualKeyframeTracks.TRANSLATION_Y;
 assert.equal(scroll.keyframes.find(k=>k.timelinePosition===18.7).easing.type,'HOLD');
 assert.equal(scroll.keyframes.find(k=>k.timelinePosition===19.16).easing.type,'CUSTOM_CUBIC_BEZIER');
});
function extraLyric(f,id,text,y){const n={...f.texts[1],id,characters:text,parent:f.strip,y,children:[],manualKeyframeTracks:{},data:{},fills:structuredClone(f.texts[1].fills),effects:[]};f.strip.children.push(n);f.nodes.push(n);f.map.set(id,n);return n;}
test('design-only lyrics remain inactive and real added spacing changes timed scroll targets',()=>{
 const f=fixture();for(let i=1;i<f.texts.length;i++)f.texts[i].parent.y+=55;
 const extra=extraLyric(f,'extra','디자인에만 추가한 가사',99),tail=extraLyric(f,'tail','마지막 이후의 가사',979),d=D.inspect(f.root,parsed,{});
 assert.equal(d.texts.length,18);assert.equal(d.plan.untimed,2);const timed=d.plan.rows.find(r=>r.id===f.texts[1].id);assert.equal(timed.y,110);assert.equal(timed.start,18.7);
 for(const id of ['extra','tail']){const row=d.plan.rows.find(r=>r.id===id);assert.equal(row.start,null);for(const t of [0,17,19,44]){assert.equal(L.valueAt(row.opacity,t),.32);assert.equal(L.valueAt(row.blur,t),3);}}
 D.apply(d);assert.equal(extra.manualKeyframeTracks.OPACITY.keyframes.length,2);assert.equal(tail.manualKeyframeTracks.OPACITY.keyframes.at(-1).value.value,.32);
});
test('design-only lyrics can acquire a time, be cleared, and reject out-of-order times before writing',()=>{
 const f=fixture(),n=extraLyric(f,'extra','추가 가사',74);let d=D.inspect(f.root,parsed,{}, {extra:17.5});assert.equal(d.plan.untimed,0);assert.equal(d.plan.rows.find(r=>r.id===n.id).start,17.5);
 assert.throws(()=>D.inspect(f.root,parsed,{}, {extra:19}),/순서/);assert.throws(()=>D.inspect(f.root,parsed,{}, {extra:NaN}),/시간/);
 d=D.inspect(f.root,parsed,{}, {extra:null});assert.equal(d.plan.untimed,1);assert.equal(f.root.data['lyrics-motion-target'],undefined);
});
test('new lyrics on re-apply are added to the original restore list',async()=>{
 const f=fixture();D.apply(D.inspect(f.root,parsed,{}));const n=extraLyric(f,'extra','뒤늦게 추가',74),before=JSON.stringify(n.fills);D.apply(D.inspect(f.root,parsed,{}));
 assert.ok(JSON.parse(f.root.data['lyrics-motion-target']).ids.includes(n.id));await D.restore(f.root,async id=>f.map.get(id));assert.equal(JSON.stringify(n.fills),before);assert.equal(n.effects.length,0);assert.equal(n.manualKeyframeTracks.OPACITY,undefined);
});
test('background tracks and original fills restore with lyrics, without new nodes',async()=>{
 const f=fixture();f.root.fills=[{type:'IMAGE',imageHash:'original',scaleMode:'FILL'}];const count=f.nodes.length,field={type:'INDEXED_ITEM',collection:'fills',index:0,propertyId:'point1'};
 const track={baseValue:{type:'COLOR',value:{r:1,g:0,b:0,a:1}},keyframes:[]};
 D.apply(D.inspect(f.root,parsed,{}),{node:f.root,fills:[{type:'SHADER',id:'mesh',properties:{point1:track.baseValue.value}}],tracks:[{field,track}]});
 assert.equal(f.nodes.length,count);assert.equal(f.root.fills[0].type,'SHADER');assert.ok(f.root.manualKeyframeTracks.fills[0].properties.point1);
 await D.restore(f.root,async id=>f.map.get(id));assert.equal(f.root.fills[0].imageHash,'original');assert.equal(f.root.manualKeyframeTracks.fills[0].properties.point1,undefined);
});

test('applying caps a pre-existing long export timeline, reapplying trims it again, and restore retains its original length',async()=>{
 const f=fixture();f.root.applyManualKeyframeTrack({type:'PROPERTY',name:'OPACITY'},{baseValue:{type:'FLOAT',value:1},keyframes:[]});f.root.duration=178.21;
 D.apply(D.inspect(f.root,parsed,{}));assert.equal(f.root.duration,51.4);
 const shorter=L.parse(sample.split('\n').slice(0,3).join('\n'));
 D.apply(D.inspect(f.root,shorter,{}));assert.equal(f.root.duration,27.9);
 for(const n of [f.strip,...f.texts])for(const tr of [n.manualKeyframeTracks.TRANSLATION_Y,n.manualKeyframeTracks.OPACITY,...Object.values(n.manualKeyframeTracks.effects||{}).flatMap(e=>Object.values(e))].filter(Boolean)){
  assert.ok(tr.keyframes.every(k=>k.timelinePosition<=27.9));
 }
 await D.restore(f.root,async id=>f.map.get(id));assert.equal(f.root.duration,178.21);
});
