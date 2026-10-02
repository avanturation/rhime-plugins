const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('actual UI capture copies shown pixels and metadata before async encoding or further animation',async()=>{
  const source=fs.readFileSync('src/ui.js','utf8');
  const fn=source.slice(source.indexOf('  async function capture()'),source.indexOf('  function download('));
  const image={width:780,height:168,pixels:[1,2,3]},painted={frame:{settings:{width:260,height:56},phase:7,palette:[{color:{r:1,g:0,b:0}}]},outline:{gradientStops:[{position:0,color:{r:.3,g:.2,b:.1,a:.6}}]},albums:[{name:'First'}]};
  let finish,copy;
  const document={createElement(){copy={getContext:()=>({drawImage(source){copy.pixels=[...source.pixels];}}),toBlob(cb){finish=()=>cb({pixels:copy.pixels});}};return copy;}};
  const context={document,painted,$:()=>image};vm.createContext(context);vm.runInContext(fn+'\nthis.capture=capture;',context);
  const pending=context.capture();image.pixels=[4,5,6];painted.frame.settings.width=953;painted.frame.phase=20;painted.albums[0].name='Later';painted.outline.gradientStops[0].color.r=1;
  finish();const result=await pending;assert.deepEqual(result.blob.pixels,[1,2,3]);assert.equal(result.meta.frame.settings.width,260);assert.equal(result.meta.frame.phase,7);assert.equal(result.meta.albums[0].name,'First');assert.equal(result.meta.outline.gradientStops[0].color.r,.3);
});
