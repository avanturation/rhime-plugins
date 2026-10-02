const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../src/vendor/mesh-core'),A=require('../src/vendor/mesh-audio'),c={AlbumMesh:M,AlbumMeshAudio:A,module:{exports:{}}};vm.runInNewContext(fs.readFileSync('src/mesh.js','utf8'),c);const R=c.module.exports;
const settings=M.normalizeSettings({palette:['#BA715E','#D0A272','#546D7D','#686184','#36394D'].map(M.parseHex)});
function tone(hz,duration=1.2){const rate=16000;return {rate,samples:Float32Array.from({length:Math.round(rate*duration)},(_,i)=>.6*Math.sin(2*Math.PI*hz*i/rate)*(i/rate>.12&&i/rate<.65?1:0))};}
function source(){const properties={};for(let i=0;i<16;i++)properties['p'+i]={x:i%4/3,y:Math.floor(i/4)/3,color:{r:.5,g:.3,b:.4,a:1}};
 const node={id:'mesh',name:'Mesh',width:402,height:874,fills:[{type:'SHADER',id:'shader',properties}],getSharedPluginData(ns,k){return k==='settings'?JSON.stringify(settings):k==='coordinateUnits'?'{"x":1,"y":1}':'';}};return R.source(node);}
test('music analysis responds to bass and percussion frequencies and quiet audio decays',async()=>{
 const low=tone(80),high=tone(4000),a=await R.analyze([low.samples],low.rate,settings),b=await R.analyze([high.samples],high.rate,settings);
 assert.ok(a.frames.some(f=>f.bass>.3));assert.ok(b.frames.some(f=>f.hit>.15));assert.ok(a.frames.at(-1).bass<.08);assert.ok(a.frames.every(f=>[f.bass,f.vocal,f.hit,f.instruments,...f.phases].every(Number.isFinite)));
 const silence=await R.analyze([new Float32Array(low.samples.length)],low.rate,settings);assert.ok(silence.frames.every(f=>f.bass===0&&f.hit===0&&f.vocal===0&&f.instruments===0&&f.time===0));
});
test('seek and pause use deterministic audio-time snapshots, including first-line origin',async()=>{
 const t=tone(80),a=await R.analyze([t.samples],t.rate,settings),s1=R.at(a,.3,100),s2=R.at(a,.3,100);assert.deepEqual(s1,s2);
 assert.equal(R.at(a,0,100).time,0);assert.deepEqual(R.at(a,9,100),R.at(a,a.duration,100));assert.equal(R.at(null,.7,100).bass,0);
});
test('native mesh keys change colours while every point stays fixed and share audio origin',async()=>{
 const t=tone(80),a=await R.analyze([t.samples],t.rate,settings),info=source(),tracks=R.tracks(info,settings,a,.2,.7),plain=R.tracks(info,settings,a,0,.7);
 assert.equal(tracks.length,16);assert.equal(tracks[0].field.collection,'fills');assert.equal(tracks[0].field.propertyId,'p0');
 for(const tr of tracks){const first=tr.track.keyframes[0].value.value;assert.ok(tr.track.keyframes.every(k=>k.value.value.x===first.x&&k.value.value.y===first.y));assert.equal(tr.track.keyframes.at(-1).timelinePosition,.7);assert.ok(tr.track.keyframes.every(k=>k.easing.type==='LINEAR'));}
 assert.notDeepEqual(tracks[5].track.keyframes[0].value,plain[5].track.keyframes[0].value);assert.notDeepEqual(tracks[5].track.keyframes[0].value.value.color,tracks[5].track.keyframes.at(-1).value.value.color);
});
test('static PNGs and invalid settings fail before applying a gradient',()=>{
 assert.throws(()=>R.source({fills:[{type:'IMAGE'}]}),/PNG/);assert.throws(()=>R.config({palette:[]}),/JSON/);assert.throws(()=>R.tracks(source(),settings,null,0,3),/분석/);
});
