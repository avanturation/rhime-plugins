const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const M=require('../src/core'),A=require('../src/audio');

// Exercise the actual UI rendering/export functions with a controllable GPU
// and asynchronous canvas encoder, without starting DOM listeners or demo art.
function harness(){
  const messages=[],encoders=[],encodedSizes=[],nodes=new Map();let paused=0;
  function element(){const classes=new Set();return {style:{},nextElementSibling:{},setAttribute(){},replaceChildren(){},appendChild(){},append(){},classList:{contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n),toggle:(n,on)=>on?classes.add(n):classes.delete(n)},pause(){paused++;},currentTime:32};}
  function canvas(){const c={...element(),width:426,height:922,frame:0};c.getContext=()=>({drawImage:source=>{c.frame=source.frame;},fillRect(){},save(){},restore(){}});c.toBlob=cb=>{const frame=c.frame;encodedSizes.push([c.width,c.height]);encoders.push(()=>cb(new Blob([new Uint8Array([frame])])));};return c;}
  nodes.set('meshCanvas',canvas());nodes.set('compositeCanvas',canvas());nodes.set('nativeImage',canvas());
  const document={querySelector:()=>({clientWidth:534,clientHeight:618,style:{}}),createTextNode:()=>element(),createElementNS:()=>element(),querySelectorAll:()=>[],getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:tag=>tag==='canvas'?canvas():element()};
  const gpu={isContextLost:()=>false,viewport(){},useProgram(){},uniform1f(){},uniform3fv(){},uniform2fv(){},uniform4fv(){},drawArrays(){nodes.get('meshCanvas').frame++;}};
  const prefix=fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8').split('  const safe=')[0];
  const module={exports:{}};
  vm.runInNewContext(prefix+`
    gl=testGPU;state.viewMode='lyrics';coverBytes=new Uint8Array([1]);audioURL='local-test';
    module.exports={state,renderMesh,create,captureSnapshot,setView,setViewport,
      decay(){metrics={bass:0,hit:0};visualBass=visualHit=0;},
      native(snapshot){$('nativeImage').frame=77;nativeSnapshot=snapshot;$('phone').classList.add('native');}};
  })();`,{AlbumMesh:M,AlbumMeshAudio:A,document,matchMedia:()=>({matches:false}),parent:{postMessage:m=>messages.push(structuredClone(m.pluginMessage))},window:{},testGPU:gpu,module,Blob,Uint8Array,Float32Array});
  return {...module.exports,messages,encoders,encodedSizes,nodes,paused:()=>paused};
}
test('creating while playing captures the last painted frame and does not pause audio',async()=>{
  const h=harness();h.renderMesh(6,.8,.5,true,.65,.4,[1,2,3,4]);await h.create('native');
  assert.deepEqual(h.messages[0].snapshot,{model:'color-flow-v2',time:6,bass:.8,hit:.5,vocal:.65,instruments:.4,phases:[1,2,3,4],strength:100,audioTimeSeconds:32});assert.equal(h.paused(),0);
});
test('paused-frame capture survives decaying meters; resetting the rendered view clears it',async()=>{
  const h=harness();h.renderMesh(8,.9,.6,true);h.decay();await h.create('native');assert.equal(h.messages[0].snapshot.bass,.9);
  const reset=harness();reset.renderMesh(8,.9,.6,true);reset.renderMesh();await reset.create('native');assert.equal(reset.messages[0].snapshot,null);
});
test('PNG encoding and snapshot parameters refer to the same frame despite later animation',async()=>{
  const h=harness();h.renderMesh(4,.7,.4,true);const firstColour={...h.state.palette[0]},pending=h.create();
  h.renderMesh(9,.2,.9,true);h.state.palette[0].r=0;assert.equal(h.messages.length,0);
  h.encoders.shift()();await pending;const msg=h.messages[0];
  assert.equal(msg.snapshot.time,4);assert.equal(msg.snapshot.bass,.7);assert.equal(msg.compositeBytes[0],1);assert.deepEqual(msg.settings.palette[0],firstColour);assert.equal(h.paused(),0);
});
test('native preview captures before pausing and creating from that preview retains the snapshot',async()=>{
  const h=harness();h.renderMesh(3,.6,.4,true);await h.create('native',true);assert.equal(h.paused(),1);assert.equal(h.messages[0].snapshot.time,3);
  const next=harness();next.renderMesh(11,.1,.8,true);next.native(h.messages[0].snapshot);await next.create('native');assert.deepEqual(next.messages[0].snapshot,h.messages[0].snapshot);
});

test('both layouts animate and switching views preserves paused and native snapshots',async()=>{
  const h=harness();h.state.viewMode='normal';h.renderMesh(5,.9,.8,true,.7,.6,[1,2,3,4]);
  const snapshot=h.captureSnapshot();assert.equal(snapshot.model,'color-flow-v2');
  h.setView('lyrics');assert.deepEqual(h.captureSnapshot(),snapshot);
  h.setView('normal');assert.deepEqual(h.captureSnapshot(),snapshot);
  await h.create('native');assert.deepEqual(h.messages[0].snapshot,snapshot);assert.equal(h.paused(),0);
  h.native(snapshot);h.setView('lyrics');assert.deepEqual(h.captureSnapshot(),snapshot);
});

 test('default output copies the displayed native image when that preview is active',async()=>{
  const h=harness();h.renderMesh(1,.2,.3,true);h.native({time:2,bass:.5,hit:.4,strength:100});
  const pending=h.create();h.renderMesh(5,.9,.8,true);h.encoders.shift()();await pending;
  assert.equal(h.messages[0].renderer,'composite');assert.equal(h.messages[0].compositeBytes[0],77);
  assert.equal(h.messages[0].snapshot.time,2);assert.equal(h.paused(),0);
});

test('Duo resizing preserves a paused colour snapshot and changes preview and capture dimensions together',async()=>{
  const h=harness();h.renderMesh(7,.7,.8,true,.3,.6,[1,2,3,4]);const snapshot=h.captureSnapshot();
  h.setViewport('duo');assert.deepEqual(h.captureSnapshot(),snapshot);assert.equal(h.paused(),0);
  assert.equal(h.nodes.get('meshCanvas').width,977);assert.equal(h.nodes.get('meshCanvas').height,719);
  assert.equal(h.nodes.get('compositeCanvas').width,953);assert.equal(h.nodes.get('compositeCanvas').height,671);
  const pending=h.create();h.setViewport('iphone');h.encoders.shift()();await pending;
  assert.deepEqual(h.encodedSizes,[[953,671]]);assert.equal(h.messages[0].settings.width,953);
  assert.equal(h.messages[0].settings.height,671);assert.deepEqual(h.messages[0].snapshot,snapshot);
  assert.equal(h.nodes.get('compositeCanvas').width,402);assert.equal(h.nodes.get('compositeCanvas').height,874);
  assert.deepEqual(h.captureSnapshot(),snapshot);
});
