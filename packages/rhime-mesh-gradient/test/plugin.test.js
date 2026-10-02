const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const M=require('../src/core');
const code=fs.readFileSync(require('node:path').join(__dirname,'../code.js'),'utf8');
function harness(options={}) {
  const images=[],messages=[],nodes=[],page={selection:[],children:[]};let id=0;
  function node(type){
    let fills=[];const shared=new Map();
    const n={id:String(++id),type,parent:page,children:[],removed:false,width:100,height:100,x:0,y:0,
      resize(w,h){this.width=w;this.height=h;},appendChild(child){child.parent=this;this.children.push(child);page.children=page.children.filter(n=>n!==child);},
      setSharedPluginData(ns,key,value){assert.match(ns,/^[A-Za-z0-9_.]+$/);shared.set(ns+':'+key,value);},getSharedPluginData(ns,key){return shared.get(ns+':'+key)||'';},
      setPluginData(){if(options.noPluginId)throw new Error('private plugin data requires ID');},remove(){this.removed=true;this.parent.children=this.parent.children.filter(c=>c!==this);this.children.forEach(c=>c.removed=true);},
      async exportAsync(){if(options.failExport)throw new Error('render failed');return new Uint8Array([137,80,78,71]);},
      get fills(){return fills;},set fills(value){if(options.failShader&&value.some(v=>v.type==='SHADER'))throw new Error('shader unavailable');fills=value;}};
    nodes.push(n);page.children.push(n);return n;
  }
  const defs={};for(let i=0;i<16;i++)defs['color-'+i]={name:'Color '+(i+1),type:'COLOR_POINT',defaultValue:{x:(i%4)/3,y:Math.floor(i/4)/3,color:{r:1,g:0,b:0}}};
  const figma={currentPage:page,ui:{postMessage:m=>messages.push(m)},showUI(){},on(){},notify(){},commitUndo(){},
    viewport:{center:{x:0,y:0},scrollAndZoomIntoView(){}},createFrame:()=>node('FRAME'),createRectangle:()=>node('RECTANGLE'),createImage:b=>{images.push(Array.from(b));return {hash:'image'};},
    async listAvailableShaders(){return options.emptyShaderList?[]:[{id:'mesh-native',name:'Mesh gradient',type:'fill'}];},
    async importShaderById(id){return {id,name:'Mesh gradient',type:'fill',imported:true,propertyDefinitions:defs};}};
  if(options.noShaderAPI){delete figma.listAvailableShaders;delete figma.importShaderById;}
  vm.runInNewContext(code,{figma,__html__:'',Uint8Array,console});
  return {figma,images,messages,nodes,page,send:msg=>figma.ui.onmessage(msg)};
}
const input=()=>({type:'create',renderer:'native',coverBytes:new Uint8Array([1,2,3]),settings:{...M.preset('original'),shaderId:'mesh-native',theme:'dark',palette:['#BE6F54','#DBAF7B','#647B8C','#6F587B','#28364C'].map(M.parseHex)}});
test('native creation writes exactly the requested 402×874 stack and keeps shader editable',async()=>{
  const h=harness();await h.send(input());
  const f=h.page.children.find(n=>n.type==='FRAME');assert.ok(f);assert.equal(f.width,402);assert.equal(f.height,874);
  assert.equal(f.children.length,3);assert.equal(f.children[0].fills[0].opacity,.64);assert.equal(f.children[1].fills[0].type,'SHADER');assert.equal(f.children[1].fills[0].opacity,.8);
  assert.equal(f.children[2].fills[0].opacity,.8);assert.equal(f.children[2].effects[0].type,'BACKGROUND_BLUR');assert.equal(f.children[2].effects[0].radius,80);
  assert.equal(Object.keys(f.children[1].fills[0].properties).length,16);assert.equal(h.page.selection[0],f);
  assert.equal(h.messages.at(-1).type,'created');assert.equal(h.page.children.length,1);
  assert.equal(h.messages.at(-1).geometry.movedPoints,4);
  assert.notEqual(f.children[1].fills[0].properties['color-5'].x,1/3);
});
test('native preview exports and removes its own temporary frame',async()=>{
  const h=harness();await h.send({...input(),type:'native-preview',revision:3});
  assert.equal(h.page.children.length,0);assert.equal(h.messages.at(-1).type,'native-preview');assert.equal(h.messages.at(-1).revision,3);
});
test('render failure rolls back generated document nodes',async()=>{
  const h=harness({failExport:true});await h.send({...input(),type:'native-preview'});
  assert.equal(h.page.children.length,0);assert.equal(h.messages.at(-1).type,'error');
});
test('unavailable shader API explains the issue and never silently inserts PNG',async()=>{
  const h=harness({noShaderAPI:true});await h.send({type:'init'});assert.equal(h.messages.at(-1).shaders.length,0);
  await h.send(input());assert.equal(h.messages.at(-1).type,'error');assert.equal(h.page.children.length,0);
});
test('explicit raster output is named as static and uses an image fill',async()=>{
  const h=harness();await h.send({...input(),renderer:'raster',meshBytes:new Uint8Array([3,4])});
  const f=h.page.children[0];assert.match(f.name,/Static PNG/);assert.equal(f.children[1].fills[0].type,'IMAGE');
});
test('bad input does not modify the page',async()=>{
  const h=harness();await h.send({...input(),coverBytes:[]});assert.equal(h.page.children.length,0);assert.equal(h.messages.at(-1).type,'error');
});
test('unregistered local development plugin creates a native background without private metadata',async()=>{
  const h=harness({noPluginId:true});await h.send(input());assert.equal(h.messages.at(-1).type,'created');
});
test('built-in shader omitted by list API is discovered from existing fill; numeric settings survive',async()=>{
  const h=harness({emptyShaderList:true});const existing=h.figma.createRectangle();existing.name='Mesh';
  const properties={tessellation:256};
  for(let i=0;i<16;i++)properties['point-'+i]={x:(i%4)/3*100,y:Math.floor(i/4)/3*100,color:{r:1,g:0,b:1}};
  existing.fills=[{type:'SHADER',id:'mesh-native',properties,opacity:.8}];h.page.selection=[existing];
  h.figma.importShaderById=async()=>{throw new Error('A built-in already in the file should not require import');};
  await h.send({type:'init'});const list=h.messages.find(m=>m.type==='shaders');assert.equal(list.shaders.length,1);
  await h.send(input());assert.equal(h.messages.at(-1).type,'created');
  const frame=h.page.children.find(n=>n.type==='FRAME');assert.equal(frame.children[1].fills[0].properties.tessellation,256);
  assert.equal(existing.fills[0].properties['point-0'].color.r,1);
  assert.notEqual(frame.children[1].fills[0].properties['point-0'].color.r,1);
  assert.equal(existing.fills[0].properties['point-5'].x,(1/3)*100);
  assert.notEqual(frame.children[1].fills[0].properties['point-5'].x,100/3);
});
test('native creation freezes the click-time snapshot before an asynchronous shader import',async()=>{
  const h=harness(),load=h.figma.importShaderById;let release;
  h.figma.importShaderById=async id=>{await new Promise(resolve=>{release=resolve;});return load(id);};
  const message=input(),snapshot={time:7,bass:.75,hit:.8,strength:100,audioTimeSeconds:31.5};message.snapshot={...snapshot};
  const pending=h.send(message);message.snapshot.time=15;message.snapshot.bass=0;release();await pending;
  const frame=h.page.children.find(n=>n.type==='FRAME'),result=h.messages.at(-1);
  assert.match(frame.name,/Snapshot/);assert.equal(result.type,'created');assert.equal(result.snapshot.time,7);
  assert.equal(result.snapshot.audioTimeSeconds,31.5);assert.equal(result.geometry.movedPoints,16);
  const flow=M.motionFlow(snapshot.time,snapshot.bass,snapshot.hit,snapshot.strength),base=M.warpPoint(1/3,1/3,M.layoutWarp(message.settings)),point=M.flowPoint(base.x,base.y,flow),actual=frame.children[1].fills[0].properties['color-5'];
  assert.ok(Math.abs(actual.x-point.x)<1e-10);assert.ok(Math.abs(actual.y-point.y)<1e-10);
});
test('native preview preserves its snapshot for subsequent creation and cleans up the temporary frame',async()=>{
  const h=harness(),snapshot={time:5,bass:.7,hit:.8,strength:100};
  await h.send({...input(),type:'native-preview',snapshot,revision:4});
  const preview=h.messages.at(-1);assert.equal(preview.type,'native-preview');assert.equal(preview.geometry.movedPoints,16);assert.equal(h.page.children.length,0);
  await h.send({...input(),snapshot:preview.snapshot});
  assert.equal(JSON.stringify(h.messages.at(-1).geometry),JSON.stringify(preview.geometry));
});
test('invalid snapshots fail before creating any document nodes',async()=>{
  const h=harness();await h.send({...input(),snapshot:{time:0,bass:Infinity,hit:0,strength:100}});
  assert.equal(h.messages.at(-1).type,'error');assert.equal(h.nodes.length,0);
});
test('reopening an extended snapshot retains coordinate units from shared metadata',async()=>{
  const first=harness();await first.send({...input(),snapshot:{time:9,bass:.85,hit:.7,strength:180}});
  const mesh=first.page.children[0].children[1],units=mesh.getSharedPluginData('rhime_mesh_gradient','coordinateUnits');
  assert.equal(units,'{"x":1,"y":1}');
  const reopened=harness({emptyShaderList:true}),template=reopened.figma.createRectangle();
  template.fills=mesh.fills;template.setSharedPluginData('rhime_mesh_gradient','coordinateUnits',units);reopened.page.selection=[template];
  reopened.figma.importShaderById=async()=>{throw new Error('Use the shader already applied in the file');};
  await reopened.send({type:'init'});
  const message=input();message.settings.pointVariation=0;await reopened.send(message);
  const result=reopened.messages.at(-1);assert.equal(result.type,'created');
  for(const point of result.geometry.points){
    assert.ok(Math.abs(point.before.x-mesh.fills[0].properties[point.id].x)<1e-10);
    assert.ok(Math.abs(point.before.y-mesh.fills[0].properties[point.id].y)<1e-10);
  }
});

test('fixed album colours and text tokens reach native output without a plugin ID',async()=>{
  const results=[];
  for(const theme of ['light','dark']){
    const h=harness({noPluginId:true}),message=input();message.settings={...message.settings,...M.preset('ambient'),theme};
    await h.send(message);const frame=h.page.children.find(n=>n.type==='FRAME');
    const tokens=JSON.parse(frame.getSharedPluginData('rhime_mesh_gradient','colorTokens'));
    assert.equal(tokens.textHex,M.albumTokens(message.settings.palette).textHex);
    assert.match(frame.name,/Album Mesh \/ Now Playing \/ Native Shader/);
    assert.equal(frame.children[0].fills[0].opacity,0);assert.equal(frame.children[1].fills[0].opacity,1);
    results.push(JSON.stringify({base:frame.fills,mesh:frame.children[1].fills,veil:frame.children[2].fills,tokens}));
  }
  assert.equal(results[0],results[1]);
});

test('new colour-flow snapshots preserve geometry and save the sampled colours',async()=>{
  const snapshot={model:'color-flow-v2',time:3,bass:.8,hit:.6,vocal:.4,instruments:.9,phases:[1,2,3,4],strength:100};
  const still=harness(),moving=harness();await still.send(input());await moving.send({...input(),snapshot});
  const a=still.page.children.find(n=>n.type==='FRAME').children[1].fills[0].properties;
  const b=moving.page.children.find(n=>n.type==='FRAME').children[1].fills[0].properties;
  let changed=0;for(const key of Object.keys(a)){assert.equal(a[key].x,b[key].x);assert.equal(a[key].y,b[key].y);if(JSON.stringify(a[key].color)!==JSON.stringify(b[key].color))changed++;}
  assert.ok(changed>8);assert.equal(moving.messages.at(-1).geometry.edgeExtendedPoints,0);
  assert.deepEqual(JSON.parse(JSON.stringify(moving.messages.at(-1).snapshot)),snapshot);
});

 test('preview PNG preserves the exact bytes without shader import or a second composition',async()=>{
  const h=harness({noShaderAPI:true,noPluginId:true}),message=input();
  message.settings.shaderId='';message.settings.meshBlendMode='HARD_LIGHT';
  await h.send({...message,renderer:'composite',compositeBytes:new Uint8Array([137,80,78,71,91])});
  const f=h.page.children[0];assert.equal(h.messages.at(-1).type,'created');
  assert.equal(f.width,402);assert.equal(f.height,874);assert.match(f.name,/Preview PNG/);
  assert.equal(f.children.length,1);assert.equal(f.children[0].fills[0].type,'IMAGE');
  assert.equal(f.children[0].fills[0].opacity,1);assert.equal(f.children[0].effects,undefined);
  assert.equal(f.children[0].blendMode,undefined);assert.deepEqual(h.images,[[137,80,78,71,91]]);
  assert.ok(f.getSharedPluginData('rhime_mesh_gradient','colorTokens'));
});
test('missing preview bytes fail without creating a frame or falling back to Shader',async()=>{
  const h=harness();await h.send({...input(),renderer:'composite'});
  assert.equal(h.messages.at(-1).type,'error');assert.equal(h.nodes.length,0);
});

test('Duo output resizes the PNG frame and every native layer, including temporary previews',async()=>{
  for(const renderer of ['composite','native']){
    const h=harness(),message=input();message.settings.width=953;message.settings.height=671;
    await h.send({...message,renderer,compositeBytes:new Uint8Array([137,80,78,71])});
    const frame=h.page.children.find(n=>n.type==='FRAME');
    for(const n of [frame,...frame.children]){assert.equal(n.width,953);assert.equal(n.height,671);}
    assert.equal(h.messages.at(-1).width,953);assert.equal(h.messages.at(-1).height,671);
  }
  const h=harness(),message=input();message.settings.width=953;message.settings.height=671;
  await h.send({...message,type:'native-preview'});
  const frame=h.nodes.find(n=>n.type==='FRAME');assert.equal(frame.width,953);assert.equal(frame.height,671);
  assert.equal(frame.removed,true);assert.equal(h.messages.at(-1).type,'native-preview');
});
