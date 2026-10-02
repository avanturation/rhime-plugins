const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../src/core'),C=require('../src/color');
const color=C.parseHex;
const albums=['#D86145','#5077CC','#A860AA','#85864B'].map((v,i)=>({id:String(i),name:'Album '+i,color:color(v)}));
test('each unique included album has one vote; duplicate and excluded covers do not inflate weight',()=>{
  const result=H.aggregate([...albums,albums[0],{id:'excluded',color:color('#00FF00'),included:false}]);
  assert.equal(result.reduce((n,g)=>n+g.weight,0),4);
  assert.equal(new Set(result.flatMap(g=>g.albumIds)).size,4);
});
test('related hues group while distinct hues remain separated without averaging into muddy colours',()=>{
  const result=H.aggregate([...albums,{id:'near',color:color('#D96046')}]);
  assert.equal(result.length,4);assert.equal(result.find(g=>g.albumIds.includes('near')).weight,2);
  for(const g of result)assert.ok(albums.some(a=>C.hex(a.color)===C.hex(g.color)));
});
test('large libraries reduce to eight source colours while retaining every album contribution',()=>{
  const many=Array.from({length:100},(_,i)=>({id:String(i),color:C.fromLch({l:.3+(i%4)*.15,c:.14,h:i*137.5})}));
  const result=H.aggregate(many);assert.ok(result.length<=8);assert.equal(result.reduce((n,g)=>n+g.weight,0),100);
  assert.equal(new Set(result.flatMap(g=>g.albumIds)).size,100);
});
test('representative prefers prominent colour over white typography and monochrome stays neutral',()=>{
  assert.equal(C.hex(H.representative([color('#FFFFFF'),color('#BB4567'),color('#080808')])),'#BB4567');
  const rep=H.representative([color('#D0D0D0'),color('#090909')]);assert.equal(rep.r,rep.g);assert.equal(rep.g,rep.b);
  const rendered=H.render(H.snapshot({},H.aggregate([{id:'gray',color:rep}])));
  // A neutral artwork never acquires an arbitrary coloured wash.
  const k=(100*rendered.width+300)*4;assert.equal(rendered.data[k],rendered.data[k+1]);assert.equal(rendered.data[k+1],rendered.data[k+2]);
});
test('export is exactly 56px high at 3x, with colour alpha and no opaque surface',()=>{
  const r=H.render(H.snapshot({height:99,radius:28,rim:3},H.aggregate(albums)));
  assert.equal(r.width,780);assert.equal(r.height,168);
  let top=0,bottom=0,max=0;
  for(let x=0;x<r.width;x++){top+=r.data[x*4+3];bottom+=r.data[((r.height-1)*r.width+x)*4+3];}
  for(let i=3;i<r.data.length;i+=4)max=Math.max(max,r.data[i]);
  assert.ok(max>30&&max<255);assert.ok(bottom>top*3);
  // The lower left corner retains pigment: no rounded clipping or rim mask.
  assert.ok(r.data[((r.height-1)*r.width)*4+3]>0);
});
test('light and dark are preview backgrounds only; PNG bytes stay identical',()=>{
  const p=H.aggregate(albums);
  assert.deepEqual(H.render(H.snapshot({theme:'light'},p,3)).data,H.render(H.snapshot({theme:'dark'},p,3)).data);
});
test('animation changes the colour underlay while retaining 56px export size',()=>{
  const p=H.aggregate(albums),a=H.render(H.snapshot({},p,0)),b=H.render(H.snapshot({},p,2));
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let delta=0;for(let i=0;i<a.data.length;i++)delta+=Math.abs(a.data[i]-b.data[i]);
  assert.ok(delta>100000);
});
test('zero strength is fully transparent, without white or dark surface pixels',()=>{
  const r=H.render(H.snapshot({strength:0},H.aggregate(albums)));
  assert.ok(r.data.every(v=>v===0));
});
test('border suggestions provide separate light and dark hex values without drawing them',()=>{
  const t=H.borderTokens(H.aggregate(albums));
  assert.match(t.light,/^#[0-9A-F]{6}$/);assert.match(t.dark,/^#[0-9A-F]{6}$/);
  assert.ok(C.toLch(C.parseHex(t.light)).l>.8);assert.ok(C.toLch(C.parseHex(t.dark)).l<.4);
  assert.equal(t.width,1);assert.equal(t.opacity,100);
});
test('capture metadata is independent of subsequent settings and palette edits',()=>{
  const s={width:260,height:56},p=H.aggregate(albums),f=H.snapshot(s,p,8);s.width=999;p[0].color.r=0;p[0].albumIds.push('later');
  assert.equal(f.settings.width,260);assert.equal(f.phase,8);assert.ok(!f.palette[0].albumIds.includes('later'));
});
test('invalid dimensions are bounded and transparent images fail cleanly',()=>{
  const s=H.normalize({width:Infinity,height:-100,radius:1000,rim:50,strength:NaN});assert.equal(s.width,260);assert.equal(s.height,56);assert.equal(s.radius,undefined);assert.equal(s.rim,undefined);
  assert.throws(()=>C.extractPalette(new Uint8ClampedArray(40)),/불투명/);
});

test('outline follows the captured bottom colours and coverage, without a white mix',()=>{
  const f=H.snapshot({},H.aggregate(albums),2),r=H.render(f),g=H.outline(f,r);
  assert.equal(g.type,'GRADIENT_LINEAR');assert.equal(g.gradientStops.length,33);
  g.gradientStops.forEach(stop=>{
    const x=Math.round(stop.position*(r.width-1)),k=((r.height-1)*r.width+x)*4;
    assert.equal(stop.color.r,r.data[k]/255);assert.equal(stop.color.g,r.data[k+1]/255);assert.equal(stop.color.b,r.data[k+2]/255);
    assert.equal(stop.color.a,Math.min(1,r.data[k+3]/255*2.2));
  });
  assert.deepEqual(H.outline(f),g);
});
test('outline is independent of preview theme and vanishes with colour strength zero',()=>{
  const p=H.aggregate(albums);
  assert.deepEqual(H.outline(H.snapshot({theme:'light'},p,2)),H.outline(H.snapshot({theme:'dark'},p,2)));
  assert.ok(H.outline(H.snapshot({strength:0},p)).gradientStops.every(s=>s.color.a===0));
});
