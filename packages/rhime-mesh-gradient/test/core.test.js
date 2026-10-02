const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../src/core');
const colors=['#BE6F54','#DBAF7B','#647B8C','#6F587B','#28364C'].map(M.parseHex);
const pixels=(hex,n)=>{const c=M.parseHex(hex);return Array.from({length:n},()=>[c.r*255,c.g*255,c.b*255,255]).flat();};
test('sRGB / OKLab round-trip stays within one RGB channel unit',()=>{
  for(const h of ['#000000','#FFFFFF','#BE6F54','#00FF00','#1200FE','#7C7C7C']) {
    const c=M.parseHex(h),r=M.fromLab(M.toLab(c));
    for(const key of ['r','g','b'])assert.ok(Math.abs(c[key]-r[key])<1/255);
  }
});
test('dominant palette preserves major colours and is deterministic',()=>{
  const data=new Uint8ClampedArray([...pixels('#BE6F54',1300),...pixels('#DBAF7B',1000),...pixels('#647B8C',700),...pixels('#6F587B',500),...pixels('#28364C',600)]);
  const a=M.extractPalette(data),b=M.extractPalette(data);
  assert.deepEqual(a,b);assert.equal(a.length,5);
  for(const expected of colors)assert.ok(a.some(c=>Math.hypot(...M.toLab(c).map((v,i)=>v-M.toLab(expected)[i]))<.06));
});
test('white borders and sparse ink do not dominate a colourful cover',()=>{
  const data=new Uint8ClampedArray([...pixels('#FFFFFF',1500),...pixels('#000000',300),...pixels('#BE6F54',1300),...pixels('#647B8C',1300)]);
  const p=M.extractPalette(data);for(const c of p)assert.ok(M.toLab(c)[0]>.12&&M.toLab(c)[0]<.94);
});
test('monochrome inputs remain monochrome; transparent images fail clearly',()=>{
  for(const h of ['#000000','#FFFFFF','#777777'])for(const c of M.extractPalette(new Uint8ClampedArray(pixels(h,64)))){
    assert.ok(Math.abs(c.r-c.g)<.0001&&Math.abs(c.g-c.b)<.0001);
  }
  assert.throws(()=>M.extractPalette(new Uint8ClampedArray(128)),/픽셀/);
});
test('literal preset composes 16% mesh and 2.56% cover; weights sum to 1',()=>{
  const s=M.preset('original'),w=M.compositeWeights(s);
  assert.ok(Math.abs(w.mesh-.16)<1e-12);assert.ok(Math.abs(w.cover-.0256)<1e-12);
  assert.ok(Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.equal(M.normalizeSettings({width:1,height:99}).width,402);
  assert.equal(M.normalizeSettings({width:1,height:99}).height,874);
});
test('native shader properties use definition IDs, preserve 4×4 coordinates, map all colours',()=>{
  const defs={},defaults={};
  for(let i=0;i<16;i++){defs['uuid-'+i]={type:'COLOR_POINT',name:'Point '+(i+1)};defaults['uuid-'+i]={x:(i%4)/3*100,y:Math.floor(i/4)/3*100,color:{r:1,g:0,b:1}};}
  defs.speed={name:'Speed',type:'NUMBER',defaultValue:1};
  const a=M.shaderAssignments(defs,colors,0,defaults,{pointVariation:0});
  assert.equal(a.mapped,16);assert.equal(Object.keys(a.properties).length,16);assert.equal(a.properties.speed,undefined);
  for(let i=0;i<16;i++){const v=a.properties['uuid-'+i];assert.equal(v.x,defaults['uuid-'+i].x);assert.equal(v.y,defaults['uuid-'+i].y);for(const n of Object.values(v.color))assert.ok(n>=0&&n<=1);}
  assert.notDeepEqual(a.properties['uuid-0'].color,a.properties['uuid-15'].color);
});
test('unsupported shaders and missing coordinates fail instead of silently creating another renderer',()=>{
  assert.throws(()=>M.shaderAssignments({x:{type:'NUMBER'}},colors),/색상/);
  assert.throws(()=>M.shaderAssignments({x:{type:'COLOR_POINT'}},colors),/좌표/);
});
test('normalization rejects NaN and clamps all motion and opacity ranges',()=>{
  const s=M.normalizeSettings({coverOpacity:NaN,meshOpacity:2,veilOpacity:-1,blur:Infinity,motionAmount:99,bpm:1});
  assert.equal(s.coverOpacity,0);assert.equal(s.meshOpacity,1);assert.equal(s.veilOpacity,0);assert.equal(s.blur,36);assert.equal(s.motionAmount,99);assert.equal(s.bpm,40);
  assert.equal(M.normalizeSettings({motionAmount:999}).motionAmount,180);
});
test('cover content and shuffle seed change positions; palette edits do not',()=>{
  const data=new Uint8Array([255,0,0,255,0,0,255,255]),flipped=new Uint8Array([0,0,255,255,255,0,0,255]);
  assert.notEqual(M.coverSeed(data),M.coverSeed(flipped));
  const settings={coverSeed:M.coverSeed(data),pointVariation:.7},a=M.layoutWarp(settings);
  assert.deepEqual(a,M.layoutWarp(settings));assert.notDeepEqual(a,M.layoutWarp({...settings,seed:1}));
  assert.notDeepEqual(a,M.layoutWarp({...settings,coverSeed:M.coverSeed(flipped)}));
  assert.deepEqual(a,M.layoutWarp({...settings,palette:[]}));
});
test('point mapping moves interiors, preserves boundaries and units, and keeps colours attached',()=>{
  for(const units of [[1,1],[100,100],[402,874]]){
    const defs={};for(let i=0;i<16;i++)defs[i]={type:'COLOR_POINT',name:'Point '+i,defaultValue:{x:(i%4)/3*units[0],y:Math.floor(i/4)/3*units[1]}};
    const original=M.shaderAssignments(defs,colors,3,{}, {pointVariation:0}),moved=M.shaderAssignments(defs,colors,3,{}, {pointVariation:1});
    assert.equal(moved.geometry.movedPoints,4);assert.ok(moved.geometry.maxMovePx>10);
    for(let i=0;i<16;i++){
      const p=moved.properties[i];assert.ok(p.x>=0&&p.x<=units[0]&&p.y>=0&&p.y<=units[1]);
      assert.deepEqual(p.color,original.properties[i].color);
      if(i<4||i>=12||i%4===0||i%4===3){assert.equal(p.x,original.properties[i].x);assert.equal(p.y,original.properties[i].y);}
    }
  }
});
test('deformation stays invertible and pins all four edges for many seeds',()=>{
  for(let seed=0;seed<80;seed++){
    const w=M.layoutWarp({seed,pointVariation:1});
    for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
      const x=i/10,y=j/10,p=M.warpPoint(x,y,w),back=M.unwarpPoint(p.x,p.y,w);
      assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);assert.ok(Math.hypot(x-back.x,y-back.y)<1e-7);
      if(!i||!j||i===10||j===10)assert.deepEqual(p,{x,y});
    }
  }
});
test('bass and percussion carry broad colour regions independently',()=>{
  const a=M.flowPoint(.4,.6,M.motionFlow(3,0,0,100)),b=M.flowPoint(.4,.6,M.motionFlow(3,1,0,100)),c=M.flowPoint(.4,.6,M.motionFlow(3,0,1,100));
  assert.ok(Math.abs(a.x-b.x)*402>30);assert.ok(Math.abs(a.y-c.y)*874>30);
  assert.deepEqual(M.flowPoint(.4,.6,M.motionFlow(3,1,1,100,false)),{x:.4,y:.6});
});
test('maximum flow is invertible beyond the viewport and never creates uncovered pixels',()=>{
  for(let time=0;time<20;time+=.7)for(const strength of [0,100,180])for(const x of [-.5,0,.33,.8,1,1.5])for(const y of [-.5,0,.33,.8,1,1.5]){
    const f=M.motionFlow(time,Math.abs(Math.sin(time)),Math.abs(Math.cos(time)),strength),p=M.flowPoint(x,y,f),back=M.unflowPoint(p.x,p.y,f);
    assert.ok(Math.hypot(x-back.x,y-back.y)<1e-10);
  }
});
test('sound changes the rendered colour field over a meaningful area, not only debug points',()=>{
  const palette=['#D4D5D5','#A6A9A6','#4E8167','#A96B79','#243626'].map(M.parseHex),sample=M.field(palette);
  const quiet=M.motionFlow(2,.15,.08,100),hit=M.motionFlow(2,.85,.9,100);
  let visible=0,total=0,difference=0;
  for(let y=0;y<44;y++)for(let x=0;x<20;x++){
    const a=M.unflowPoint(x/20,y/44,quiet),b=M.unflowPoint(x/20,y/44,hit),ca=sample(a.x,a.y),cb=sample(b.x,b.y);
    const d=(Math.abs(ca.r-cb.r)+Math.abs(ca.g-cb.g)+Math.abs(ca.b-cb.b))/3;
    difference+=d;visible+=d>.025?1:0;total++;
  }
  assert.ok(visible/total>.5);assert.ok(difference/total>.06);
});
test('accent colours remain in separate regions after reducing the pattern density',()=>{
  const palette=['#D4D5D5','#A6A9A6','#4E8167','#A96B79','#243626'].map(M.parseHex);
  const sample=M.field(palette),labs=palette.map(M.toLab),width=45,height=100,labels=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const lab=M.toLab(sample((x+.5)/width,(y+.5)/height));
    const distances=labs.map(c=>c.reduce((sum,v,i)=>sum+(v-lab[i])**2,0));
    labels.push(distances.indexOf(Math.min(...distances)));
  }
  for(const accent of [2,3]){
    const seen=new Set(),regions=[];
    for(let start=0;start<labels.length;start++){
      if(labels[start]!==accent||seen.has(start))continue;
      const queue=[start];seen.add(start);
      for(let i=0;i<queue.length;i++){
        const n=queue[i],x=n%width,y=Math.floor(n/width);
        for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx,ny=y+dy,next=ny*width+nx;
          if(nx<0||nx>=width||ny<0||ny>=height||seen.has(next)||labels[next]!==accent)continue;
          seen.add(next);queue.push(next);
        }
      }
      if(queue.length>=30)regions.push(queue.length);
    }
    assert.ok(regions.length>=2,`Accent ${accent} is concentrated in ${regions.length} regions`);
  }
});
test('flowing past the screen retains the distributed field without a colour seam',()=>{
  const sample=M.field(colors,4);
  for(const x of [-1.3,-.5,0,.5,1,1.5])for(const y of [-1.1,-.3,0,.5,1,1.3]){
    const a=sample(x,y),b=sample(x+1.65,y+1.64);
    for(const channel of ['r','g','b'])assert.ok(Math.abs(a[channel]-b[channel])<1e-10);
  }
});
test('lyrics preset keeps the original preset available and lets motion show through',()=>{
  assert.equal(M.preset('original','light').veilOpacity,.8);
  for(const theme of ['light','dark']){const p=M.preset('lyrics',theme);assert.equal(p.meshOpacity,1);assert.equal(p.blur,20);assert.ok(M.compositeWeights(p).mesh>.6);}
});
test('snapshot retains interior flow and colour while extending boundary points beyond the viewport',()=>{
  const snapshot={time:9,bass:.85,hit:.7,strength:180},flow=M.motionFlow(snapshot.time,snapshot.bass,snapshot.hit,snapshot.strength);
  for(const [unitX,unitY]of [[1,1],[100,100],[402,874]]){
    const defs={};for(let i=0;i<16;i++)defs[i]={type:'COLOR_POINT',defaultValue:{x:(i%4)/3*unitX,y:Math.floor(i/4)/3*unitY}};
    const base=M.shaderAssignments(defs,colors),captured=M.shaderAssignments(defs,colors,0,{}, {},snapshot);
    assert.equal(captured.geometry.movedPoints,16);
    for(let i=0;i<16;i++){
      const p=base.properties[i],next=M.flowPoint(p.x/unitX,p.y/unitY,flow),actual=captured.properties[i];
      if(i>=4&&i<12&&i%4!==0&&i%4!==3){
        assert.ok(Math.abs(actual.x/unitX-next.x)<1e-10);assert.ok(Math.abs(actual.y/unitY-next.y)<1e-10);assert.deepEqual(actual.color,p.color);
      }else{
        if(i%4===0)assert.ok(actual.x<0);if(i%4===3)assert.ok(actual.x>unitX);
        if(i<4)assert.ok(actual.y<0);if(i>=12)assert.ok(actual.y>unitY);
      }
    }
    assert.ok(Object.values(captured.properties).some(p=>p.x<0||p.x>unitX||p.y<0||p.y>unitY));
    const reused=M.shaderAssignments(defs,colors,0,captured.properties,{pointVariation:0,coordinateUnits:captured.geometry.coordinateUnits});
    for(let i=0;i<16;i++){
      assert.ok(Math.abs(reused.geometry.points[i].before.x-captured.properties[i].x/unitX)<1e-10);
      assert.ok(Math.abs(reused.geometry.points[i].before.y-captured.properties[i].y/unitY)<1e-10);
    }
  }
});
test('snapshot validation rejects invalid flow and unsupported point shaders',()=>{
  const original={time:8,bass:.4,hit:.7,strength:100},captured=M.normalizeSnapshot(original);original.bass=0;
  assert.equal(captured.bass,.4);assert.equal(M.normalizeSnapshot(null),null);
  for(const value of [{...captured,time:NaN},{...captured,bass:Infinity},{...captured,hit:-1},{...captured,strength:181},{}])assert.throws(()=>M.normalizeSnapshot(value),/스냅샷/);
  assert.throws(()=>M.shaderAssignments({tint:{type:'COLOR'}},colors,0,{}, {},captured),/COLOR_POINT/);
});

test('album treatment is independent of light/dark and has one default stack',()=>{
  assert.deepEqual(M.normalizeSettings({theme:'light'}),M.normalizeSettings({theme:'dark'}));
  for(const name of ['ambient','balanced','lyrics'])assert.deepEqual(M.preset(name,'light'),M.preset(name,'dark'));
  const s=M.normalizeSettings();assert.equal(s.theme,'album');assert.equal(s.coverOpacity,0);assert.equal(s.meshOpacity,1);
  assert.equal(s.veilOpacity,.08);assert.equal(s.blur,36);
});
test('OKLCH text stays near white, follows album hue and leaves monochrome neutral',()=>{
  for(const h of ['#CA463F','#387E5B','#355AD0','#D8AC30']){
    const original=M.toLch(M.parseHex(h)),tokens=M.albumTokens([M.parseHex(h)]),t=M.toLch(tokens.text);
    assert.ok(Math.abs(t.l-.97)<.00001);assert.ok(t.c>0&&t.c<=.00801);
    assert.ok(Math.abs(t.h-original.h)<.001);assert.match(tokens.textHex,/^#[0-9A-F]{6}$/);
  }
  for(const h of ['#000000','#777777','#FFFFFF']){
    const tokens=M.albumTokens([M.parseHex(h)]);assert.ok(M.toLch(tokens.text).c<.00001);
    for(const c of M.ambientPalette([M.parseHex(h)]))assert.ok(M.toLch(c).c<.00001);
  }
});
test('OKLCH gamut mapping preserves hue and lightness for saturated colours',()=>{
  for(const l of [.15,.45,.8,.97])for(const h of [0,45,90,180,270]){
    const color=M.fromLch({l,c:.4,h}),actual=M.toLch(color);
    assert.ok(Object.values(color).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(Math.abs(actual.l-l)<.00001);
    assert.ok(Math.abs(((actual.h-h+540)%360)-180)<.01);
  }
});
test('background palette retains distinct pools on low-chroma covers and readable white text',()=>{
  const source=['#1C1818','#413030','#5F4C4C','#7E6969','#A69394'].map(M.parseHex);
  const ambient=M.ambientPalette(source,'lyrics').map(M.toLch),spread=values=>Math.max(...values)-Math.min(...values);
  assert.ok(spread(ambient.map(c=>c.l))>.22);
  assert.ok(ambient.every(c=>c.l>=.21999&&c.l<=.54001&&c.c<=.13001));
  const white=M.albumTokens(source).text;
  const luminance=c=>[c.r,c.g,c.b].map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  for(const c of M.ambientPalette([...source,...colors,M.parseHex('#FFFF00')],'lyrics'))assert.ok((luminance(white)+.05)/(luminance(c)+.05)>4.5);
});
test('periodic field joins have continuous slopes rather than nearest-image cusps',()=>{
  for(const radius of [.18,.34,.6]){
    const edge=1.65/2,eps=1e-5,f=x=>M.periodicWeight(x,radius,1.65);
    const left=(f(edge)-f(edge-eps))/eps,right=(f(edge+eps)-f(edge))/eps;
    assert.ok(Math.abs(left-right)<.001,`radius ${radius}: ${left} vs ${right}`);
  }
});
test('harmonized field still visibly responds to sound with unchanged point motion',()=>{
  const sample=M.field(M.ambientPalette(colors)),quiet=M.motionFlow(2,.15,.08,100),hit=M.motionFlow(2,.85,.9,100);
  let changed=0,total=0;
  for(let y=0;y<44;y++)for(let x=0;x<20;x++){
    const a=M.unflowPoint(x/20,y/44,quiet),b=M.unflowPoint(x/20,y/44,hit),ca=sample(a.x,a.y),cb=sample(b.x,b.y);
    const delta=Math.hypot(...M.toLab(ca).map((v,i)=>v-M.toLab(cb)[i]));
    changed+=delta>.01?1:0;total++;
  }
  assert.ok(changed/total>.5);
});

test('four colour-flow channels change colour independently without moving native points',()=>{
  const palette=['#1C1818','#413030','#5F4C4C','#7E6969','#A69394'].map(M.parseHex);
  const defs={};for(let i=0;i<16;i++)defs[i]={type:'COLOR_POINT',defaultValue:{x:i%4/3,y:Math.floor(i/4)/3}};
  const quiet={model:'color-flow-v2',time:5,bass:0,hit:0,vocal:0,instruments:0,phases:[1,2,3,4],strength:100};
  const base=M.shaderAssignments(defs,palette,0,{}, {viewMode:'lyrics'},quiet),patterns=[];
  for(const channel of ['bass','vocal','hit','instruments']){
    const active={...quiet,[channel]:1},next=M.shaderAssignments(defs,palette,0,{}, {viewMode:'lyrics'},active);
    assert.deepEqual(next.geometry,base.geometry);assert.equal(next.geometry.edgeExtendedPoints,0);
    let delta=0;const pattern=[];
    for(let i=0;i<16;i++){
      const a=base.properties[i],b=next.properties[i];assert.equal(a.x,b.x);assert.equal(a.y,b.y);
      const change=M.toLab(b.color)[0]-M.toLab(a.color)[0];delta+=Math.abs(change);pattern.push(change.toFixed(5));
      assert.deepEqual(b.color,M.field(M.ambientPalette(palette,'lyrics'),0,null,active,M.FIELD_CONTRAST)(i%4/3,Math.floor(i/4)/3));
    }
    assert.ok(delta/16>.008,`${channel} has no visible colour response: ${delta/16}`);patterns.push(pattern.join(','));
  }
  assert.equal(new Set(patterns).size,4);
});
test('colour snapshots preserve all four phases and reject malformed channel data',()=>{
  const s={model:'color-flow-v2',time:1,bass:.5,hit:.4,vocal:.3,instruments:.2,phases:[1,2,3,4],strength:100};
  const captured=M.normalizeSnapshot(s);s.phases[0]=99;assert.equal(captured.phases[0],1);
  for(const bad of [{vocal:NaN},{instruments:2},{phases:[0,1]},{phases:[0,-1,0,0]},{model:'unknown'}])assert.throws(()=>M.normalizeSnapshot({...s,...bad}));
  assert.deepEqual(M.colorTransport(.3,.4,{...captured,strength:0}),{x:.3,y:.4});
  assert.deepEqual(M.normalizeSettings({channelMix:{bass:9,vocal:-1,drums:NaN}}).channelMix,{bass:2,vocal:0,drums:1,instruments:1});
});

test('album and lyrics views use the same middle-ground palette and native shader',()=>{
  const palette=['#1A1616','#3F2E2E','#5E4949','#7D6A6A','#A79697'].map(M.parseHex);
  assert.deepEqual(M.ambientPalette(palette,'normal'),M.ambientPalette(palette,'lyrics'));
  const labs=M.ambientPalette(palette).map(M.toLab),range=Math.max(...labs.map(c=>c[0]))-Math.min(...labs.map(c=>c[0]));
  assert.ok(range>.20&&range<.28);
  const defs={};for(let i=0;i<16;i++)defs[i]={type:'COLOR_POINT',defaultValue:{x:i%4/3,y:Math.floor(i/4)/3}};
  const snapshot={model:'color-flow-v2',time:5,bass:.8,hit:.6,vocal:.5,instruments:.4,phases:[1,2,3,4],strength:100};
  assert.deepEqual(M.shaderAssignments(defs,palette,0,{}, {viewMode:'normal'},snapshot),M.shaderAssignments(defs,palette,0,{}, {viewMode:'lyrics'},snapshot));
  assert.equal(M.normalizeSettings({viewMode:'normal'}).blur,M.normalizeSettings({viewMode:'lyrics'}).blur);
  assert.equal(M.preset('balanced').blur,36);
  for(const name of ['ambient','balanced','lyrics'])assert.equal(M.preset(name).viewMode,undefined);
});

test('viewport normalization supports iPhone Duo while rejecting invalid or partial sizes',()=>{
  assert.equal(M.normalizeSettings().width,402);assert.equal(M.normalizeSettings().height,874);
  assert.equal(M.normalizeSettings({width:953,height:671}).width,953);
  assert.equal(M.normalizeSettings({width:953,height:671}).height,671);
  for(const size of [{width:953},{width:671,height:953},{width:Infinity,height:-1}]){
    const s=M.normalizeSettings(size);assert.equal(s.width,402);assert.equal(s.height,874);
  }
});
test('pixel-unit mesh points scale to Duo and back without changing their normalized positions',()=>{
  const defs={};for(let i=0;i<16;i++)defs['p'+i]={type:'COLOR_POINT',defaultValue:{x:i%4/3*402,y:Math.floor(i/4)/3*874,color:{r:1,g:0,b:0}}};
  const palette=['#BA715E','#D0A272','#546D7D','#686184','#36394D'].map(M.parseHex);
  const duo=M.shaderAssignments(defs,palette,0,{}, {width:953,height:671,pointVariation:0});
  assert.equal(duo.properties.p15.x,953);assert.equal(duo.properties.p15.y,671);
  assert.deepEqual(duo.geometry.coordinateUnits,{x:953,y:671});
  const phone=M.shaderAssignments(defs,palette,0,duo.properties,{pointVariation:0,coordinateUnits:duo.geometry.coordinateUnits});
  assert.equal(phone.properties.p15.x,402);assert.equal(phone.properties.p15.y,874);
  assert.deepEqual(phone.geometry.coordinateUnits,{x:402,y:874});
});
