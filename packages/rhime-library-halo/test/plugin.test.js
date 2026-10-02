const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const H=require('../src/core'),C=require('../src/color');
const png=(w=780,h=168)=>{const b=new Uint8Array(24);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(16,w);v.setUint32(20,h);return b;};
function setup(extra={}) {
  const nodes=[],messages=[],images=[];
  const node=()=>{const n={children:[],fills:[],resize(w,h){this.width=w;this.height=h;},appendChild(c){this.children.push(c);},remove(){this.removed=true;},setSharedPluginData(ns,k,v){this.meta=JSON.parse(v);}};nodes.push(n);return n;};
  const figma={ui:{postMessage:m=>messages.push(m)},currentPage:{selection:[]},viewport:{center:{x:100,y:100},scrollAndZoomIntoView(){}},on(){},showUI(){},notify(){},
    createImage:b=>{images.push(b);return {hash:'png'};},createFrame:node,createRectangle:node,createText:node,createNodeFromSvg:node,
    listAvailableFontsAsync:async()=>[],loadFontAsync:async()=>{},...extra};
  vm.runInNewContext(fs.readFileSync('src/main.js','utf8'),{LibraryHalo:H,LibraryColor:C,figma,__html__:'',Uint8Array,DataView});
  return {figma,nodes,messages,images,send:m=>figma.ui.onmessage(m)};
}
const payload=()=>({type:'create',bytes:png(),settings:{width:260,height:56},phase:3,palette:[{color:C.parseHex('#A85CA4'),weight:1,albumIds:['1']}],albums:[{name:'Cover',color:C.parseHex('#A85CA4')}]});
test('background inserts captured bytes unchanged, as one image with no extra opacity or blur',async()=>{
  const a=setup(),m=payload();await a.send(m);assert.equal(a.nodes.length,2);assert.equal(a.nodes[0].width,260);assert.equal(a.nodes[0].height,56);
  assert.equal(a.images[0],m.bytes);assert.equal(a.nodes[1].fills[0].opacity,undefined);assert.equal(a.nodes[1].effects,undefined);assert.equal(a.nodes[0].meta.phase,3);
});
test('output has a native gradient stroke, with no surface, rounding or text',async()=>{
  const a=setup({loadFontAsync:async()=>{throw new Error('No font needed');}}),m=payload();
  m.settings={width:260,height:48,radius:24,rim:1,output:'search',theme:'dark'};
  await a.send(m);assert.equal(a.nodes.length,2);
  const f=a.nodes[0];assert.equal(f.height,56);assert.equal(f.cornerRadius,0);
  assert.deepEqual([...f.fills],[]);assert.equal(f.strokes.length,1);
  assert.equal(f.strokes[0].type,'GRADIENT_LINEAR');assert.equal(f.strokeWeight,1);assert.equal(f.strokeAlign,'INSIDE');
  assert.deepEqual(f.strokes[0],H.outline(H.snapshot(m.settings,m.palette,m.phase)));assert.equal(f.clipsContent,true);
  for(const key of ['surfaceIncluded','roundingIncluded'])assert.equal(f.meta[key],false);
  assert.equal(f.meta.borderIncluded,true);assert.equal(f.meta.outlineEditable,true);
});
test('no document writes for missing palette or wrong capture dimensions',async()=>{
  const a=setup(),m=payload();m.bytes=png(1200,168);await a.send(m);assert.equal(a.nodes.length,0);assert.equal(a.messages.at(-1).type,'error');
  m.bytes=png();m.palette=[];await a.send(m);assert.equal(a.nodes.length,0);
});
test('failure during metadata write rolls back the generated frame',async()=>{
  const a=setup({createFrame(){const n={removed:false,resize(){},appendChild(){},setSharedPluginData(){throw new Error('test failure');},remove(){this.removed=true;}};a.nodes.push(n);return n;}});
  await a.send(payload());assert.equal(a.nodes[0].removed,true);assert.equal(a.messages.at(-1).type,'error');
});
test('multiple cover imports continue after a corrupt image and complete',async()=>{
  const a=setup({getImageByHash:hash=>({getBytesAsync:async()=>{if(hash==='bad')throw new Error('bad');return new Uint8Array([1,2]);}})});
  a.figma.currentPage.selection=[{name:'A',fills:[{type:'IMAGE',imageHash:'a'}]},{name:'Bad',fills:[{type:'IMAGE',imageHash:'bad'}]},{name:'B',fills:[{type:'IMAGE',imageHash:'b'}]}];
  await a.send({type:'import-selection'});assert.equal(a.messages.filter(m=>m.type==='cover').length,2);assert.equal(a.messages.filter(m=>m.type==='import-warning').length,1);assert.equal(a.messages.at(-1).type,'import-complete');assert.equal(a.nodes.length,0);
});

test('outline-only is one editable native rectangle without any image creation',async()=>{
  const a=setup({createImage(){throw new Error('Outline must not rasterize');}}),m=payload();m.type='create-outline';delete m.bytes;
  await a.send(m);assert.equal(a.messages.at(-1).type,'created');assert.equal(a.nodes.length,1);
  const n=a.nodes[0];assert.equal(n.width,260);assert.equal(n.height,56);assert.deepEqual([...n.fills],[]);
  assert.equal(n.strokes[0].type,'GRADIENT_LINEAR');assert.equal(n.meta.outlineOnly,true);assert.equal(n.meta.phase,3);
});
test('native outline uses captured phase, rather than an unrelated static palette order',async()=>{
  const a=setup(),m=payload();await a.send(m);const captured=JSON.stringify(a.nodes[0].strokes);
  m.phase=0;await a.send(m);assert.notEqual(JSON.stringify(a.nodes[2].strokes),captured);
});
