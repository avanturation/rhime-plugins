/* Shared, dependency-free colour and shader logic. Inputs/outputs use sRGB [0,1]. */
var AlbumMesh = (function () {
  'use strict';
  const W = 402, H = 874, FIELD_CONTRAST = 1.3;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const linear = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const gamma = (v) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const rgb = (c) => ({ r: clamp(finite(c && c.r, 0)), g: clamp(finite(c && c.g, 0)), b: clamp(finite(c && c.b, 0)) });
  function toLab(c) {
    const r = linear(c.r), g = linear(c.g), b = linear(c.b);
    const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
      1.9779984951*l - 2.428592205*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.808675766*s];
  }
  function rawFromLab(v) {
    const l = Math.pow(v[0] + 0.3963377774*v[1] + 0.2158037573*v[2], 3);
    const m = Math.pow(v[0] - 0.1055613458*v[1] - 0.0638541728*v[2], 3);
    const s = Math.pow(v[0] - 0.0894841775*v[1] - 1.291485548*v[2], 3);
    return {r: gamma(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
      g: gamma(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
      b: gamma(-0.0041960863*l - 0.7034186147*m + 1.707614701*s)};
  }
  const fromLab = v => rgb(rawFromLab(v));
  function toLch(c) {
    const [l,a,b]=toLab(c),chroma=Math.hypot(a,b);
    return {l,c:chroma,h:chroma<.00001?0:(Math.atan2(b,a)*180/Math.PI+360)%360};
  }
  // Reduce chroma at a fixed lightness/hue instead of clipping RGB channels.
  function fromLch({l,c,h}) {
    l=clamp(l);c=Math.max(0,c);const angle=h*Math.PI/180;
    const convert=chroma=>rawFromLab([l,chroma*Math.cos(angle),chroma*Math.sin(angle)]);
    const fits=v=>Object.values(v).every(n=>n>=0&&n<=1);
    let value=convert(c);if(fits(value))return value;
    let low=0,high=c;
    for(let i=0;i<24;i++){const mid=(low+high)/2;if(fits(convert(mid)))low=mid;else high=mid;}
    return rgb(convert(low));
  }
  function albumTokens(palette) {
    const colors=(palette.length?palette:[parseHex('#777777')]).map(toLch);
    // Palette order represents coverage. Prefer a prominent chromatic cluster
    // over black/white linework; never tint genuinely achromatic artwork.
    const dominant=colors.reduce((best,v,i)=>v.c/(1+i*.35)>best.score?{...v,score:v.c/(1+i*.35)}:best,{l:0,c:0,h:0,score:0});
    const tint=clamp(dominant.c/.04),textLch={l:.970,c:.008*tint,h:dominant.h};
    const text=fromLch(textLch),base=fromLch({l:.26,c:Math.min(.025,dominant.c*.6),h:dominant.h});
    return {text,textHex:hex(text),textOklch:`oklch(${(textLch.l*100).toFixed(1)}% ${textLch.c.toFixed(5)} ${textLch.h.toFixed(2)})`,base,baseHex:hex(base),hue:dominant.h,tint};
  }
  function ambientPalette(palette) {
    const tokens=albumTokens(palette),angle=tokens.hue*Math.PI/180,labs=palette.map(toLab);
    const low=Math.min(...labs.map(v=>v[0])),high=Math.max(...labs.map(v=>v[0])),span=high-low;
    return labs.map(lab=>{
      // Keep dark and light pools distinct even on low-chroma cover artwork.
      // Flat single-colour artwork remains flat; never manufacture a hue.
      const soft=.25+.29*lab[0],defined=span>.16?.22+.32*(lab[0]-low)/span:.22+.32*lab[0];
      const l=soft*.45+defined*.55;
      const a=lab[1]*.86+Math.cos(angle)*.005*tokens.tint;
      const b=lab[2]*.86+Math.sin(angle)*.005*tokens.tint;
      return fromLch({l,c:Math.min(.12,Math.hypot(a,b)),h:Math.atan2(b,a)*180/Math.PI});
    });
  }
  // Sum the neighbouring Gaussian images. The nearest-image shortcut has a
  // visible slope cusp at each repeat boundary, especially with dark artwork.
  function periodicWeight(d,r,period) {
    d-=Math.floor(d/period+.5)*period;
    let weight=0;for(let k=-2;k<=2;k++)weight+=Math.exp(-(((d+k*period)/r)**2));
    return weight;
  }
  const dist = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  const hex = (c) => '#' + [c.r,c.g,c.b].map(v => Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
  function parseHex(v) {
    if (!/^#?[0-9a-f]{6}$/i.test(v)) throw new Error('6자리 HEX 색상을 입력해 주세요.');
    const s = v.replace('#','');
    return {r: parseInt(s.slice(0,2),16)/255, g: parseInt(s.slice(2,4),16)/255, b: parseInt(s.slice(4,6),16)/255};
  }
  function extractPalette(data, count = 5) {
    const pixels = [];
    const stride = Math.max(1, Math.ceil(data.length / 4 / 6000));
    for (let i = 0; i < data.length; i += 4*stride) {
      if (data[i+3] < 128) continue;
      const lab = toLab({r:data[i]/255, g:data[i+1]/255, b:data[i+2]/255});
      pixels.push({lab, w:data[i+3]/255});
    }
    if (!pixels.length) throw new Error('불투명한 이미지 픽셀이 없습니다. 다른 커버를 선택해 주세요.');
    // Suppress white borders and black typography only if enough midtones remain.
    const middle = pixels.filter(p => p.lab[0] > 0.12 && p.lab[0] < 0.94);
    const samples = middle.length > pixels.length * 0.2 ? middle : pixels;
    const histogram = new Map();
    for (const p of samples) {
      p.w *= 0.8 + Math.min(0.8, Math.hypot(p.lab[1],p.lab[2])*3);
      const key = p.lab.map(v => Math.round(v*18)).join(',');
      const bin = histogram.get(key) || {sum:[0,0,0], w:0};
      bin.w += p.w;
      for (let j=0;j<3;j++) bin.sum[j] += p.lab[j]*p.w;
      histogram.set(key,bin);
    }
    const bins = Array.from(histogram.values()).sort((a,b) => b.w-a.w);
    const centers = [bins[0].sum.map(v=>v/bins[0].w)];
    // Weighted farthest-point initialization is deterministic and ignores tiny outliers.
    while (centers.length < Math.min(count,bins.length)) {
      let best = null, score = 0;
      for (const bin of bins) {
        const v = bin.sum.map(x => x/bin.w);
        const s = Math.min(...centers.map(c=>dist(c,v))) * Math.sqrt(bin.w);
        if (s > score) { score=s; best=v; }
      }
      if (!best || score < 0.00001) break;
      centers.push(best);
    }
    let groups = [];
    for (let iter=0;iter<12;iter++) {
      groups = centers.map(()=>({sum:[0,0,0],w:0}));
      for (const p of samples) {
        let k=0, d=Infinity;
        centers.forEach((c,j)=>{const next=dist(c,p.lab);if(next<d){d=next;k=j;}});
        groups[k].w += p.w;
        for(let j=0;j<3;j++) groups[k].sum[j] += p.lab[j]*p.w;
      }
      groups.forEach((g,i)=>{if(g.w)centers[i]=g.sum.map(v=>v/g.w);});
    }
    const ordered = centers.map((lab,i)=>({lab,weight:groups[i].w})).sort((a,b)=>b.weight-a.weight);
    const unique = [];
    for(const c of ordered) if(!unique.some(v=>dist(v.lab,c.lab)<0.002)) unique.push(c);
    const result = unique.map(c=>fromLab(c.lab));
    // A monochrome cover stays monochrome. Duplicate slots remain editable.
    while(result.length<count) result.push({...result[result.length % unique.length]});
    return result.slice(0,count);
  }
  function anchors(seed=0) {
    // Broad asymmetric regions, with weaker echoes of each colour. Sites have
    // independent sizes and weights; there is no repeated row/column pattern.
    const base=[
      [.08,.08,0,.60,.25,.85], [.74,.18,2,.36,.30,1.15],
      [.26,.39,3,.52,.21,1.00], [1.08,.61,1,.43,.30,.70],
      [.57,.91,4,.61,.28,.70], [-.28,.73,2,.46,.32,.90],
      [.97,.96,3,.40,.24,.92], [.64,.57,0,.34,.27,.55],
      [-.15,1.18,1,.58,.24,.60], [1.24,-.15,4,.49,.24,.80]
    ];
    return base.map(([x,y,colorIndex,rx,ry,weight],i)=>({
      x:x+Math.sin(seed*2.13+i*4.5)*Math.sin(seed*.71)*.12,
      y:y+Math.cos(seed*1.7+i*2.3)*Math.sin(seed*.53)*.08,
      colorIndex,rx:.9*rx*(1+Math.sin(seed*.81+i)*Math.sin(seed*.37)*.12),
      ry:.9*ry*(1+Math.cos(seed*.63+i)*Math.sin(seed*.43)*.12),weight
    }));
  }
  function coverSeed(data) {
    let hash=2166136261;
    for(let i=0;i<data.length;i++) hash=Math.imul(hash^data[i],16777619);
    return hash>>>0;
  }
  function layoutWarp(settings={}) {
    let n=((settings.coverSeed||0)^Math.imul((settings.seed||0)+1,2654435761))>>>0;
    const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
    const strength=clamp(finite(settings.pointVariation,.6));
    return [(random()<.5?-1:1)*(.12+random()*.08)*strength,(random()<.5?-1:1)*(.1+random()*.08)*strength,random()*Math.PI*2,random()*Math.PI*2];
  }
  // Two monotone shears keep the boundary fixed and avoid folding the viewport.
  function warpPoint(x,y,w) {
    if(x<=0||x>=1||y<=0||y>=1)return {x,y};
    const xx=x+w[0]*Math.sin(Math.PI*x)*Math.sin(Math.PI*y)*Math.sin(2*Math.PI*y+w[2]);
    return {x:xx,y:y+w[1]*Math.sin(Math.PI*y)*Math.sin(Math.PI*xx)*Math.sin(2*Math.PI*xx+w[3])};
  }
  function unwarpPoint(x,y,w) {
    if(x<=0||x>=1||y<=0||y>=1)return {x,y};
    const solve=(v,k)=>{let p=v;for(let i=0;i<7;i++)p-= (p+k*Math.sin(Math.PI*p)-v)/(1+k*Math.PI*Math.cos(Math.PI*p));return p;};
    const yy=solve(y,w[1]*Math.sin(Math.PI*x)*Math.sin(2*Math.PI*x+w[3]));
    return {x:solve(x,w[0]*Math.sin(Math.PI*yy)*Math.sin(2*Math.PI*yy+w[2])),y:yy};
  }
  function motionFlow(time,bass,hit,strength=100,active=true) {
    const amount=active?clamp(finite(strength,100),0,180)*1.4:0;
    return {x:amount/W*(.35*Math.sin(time*.63)+.8*(bass-.35)),
      y:amount/H*(.3*Math.sin(time*.47+1.2)+.7*(hit-.25)),
      shearX:amount/W*(.4+.28*bass),shearY:amount/H*(.4+.3*hit),
      phaseX:time*.7+.4,phaseY:time*.53+1.8};
  }
  // Global shears carry broad colour regions across the viewport. They are
  // exactly invertible at every strength; the procedural fill extends past edges.
  function flowPoint(x,y,f){
    const xx=x+f.x+f.shearX*Math.sin(2.2*y+f.phaseX);
    return {x:xx,y:y+f.y+f.shearY*Math.sin(3*xx+f.phaseY)};
  }
  function unflowPoint(x,y,f){
    const yy=y-f.y-f.shearY*Math.sin(3*x+f.phaseY);
    return {x:x-f.x-f.shearX*Math.sin(2.2*yy+f.phaseX),y:yy};
  }
  const colorPhases=time=>[time*.31,time*.23,time*.37,time*.17];
  // Sample moving pigment through a fixed mesh. Geometry and text never move.
  // Four independent paths: bass wash, vocal rise, drum spread, instrument drift.
  function colorTransport(x,y,snapshot) {
    if(!snapshot||snapshot.model!=='color-flow-v2')return {x,y};
    const a=snapshot.strength/100,b=snapshot.bass,v=snapshot.vocal,d=snapshot.hit,n=snapshot.instruments;
    const p=snapshot.phases||colorPhases(snapshot.time),cx=x-.52,cy=y-.48;
    const spread=d*.48*Math.exp(-(cx*cx+cy*cy)*1.5);
    return {x:x-a*(.32*b*Math.sin(p[0]+y*1.7)+.14*v*Math.sin(p[1]+y*1.2+x*.8)+.24*n*Math.sin(p[3]+y*.9)+cx*spread),
      y:y-a*(.12*b*Math.cos(p[0]+x*1.1)+.32*v*Math.sin(p[1]+x*1.3)+.21*n*Math.cos(p[3]+x*1.8)+cy*spread+.07*d*Math.sin(p[2]+x*2.1))};
  }
  function normalizeSnapshot(value) {
    if(value==null)return null;
    const ranges={time:[0,Number.MAX_SAFE_INTEGER],bass:[0,1],hit:[0,1],strength:[0,180]},result={};
    for(const [key,[min,max]]of Object.entries(ranges)){
      if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)
        throw new Error('움직임 스냅샷을 읽을 수 없습니다. 미리보기를 다시 재생해 주세요.');
      result[key]=value[key];
    }
    if(value.model!=null&&value.model!=='color-flow-v2')throw new Error('지원하지 않는 스냅샷입니다.');
    if(value.model==='color-flow-v2'){
      result.model=value.model;
      for(const key of ['vocal','instruments']){
        if(!Number.isFinite(value[key])||value[key]<0||value[key]>1)throw new Error('색 흐름 스냅샷을 읽을 수 없습니다.');
        result[key]=value[key];
      }
      if(!Array.isArray(value.phases)||value.phases.length!==4||value.phases.some(v=>!Number.isFinite(v)||v<0))throw new Error('색 흐름 위상을 읽을 수 없습니다.');
      result.phases=value.phases.slice();
    }
    if(Number.isFinite(value.audioTimeSeconds)&&value.audioTimeSeconds>=0)result.audioTimeSeconds=value.audioTimeSeconds;
    return result;
  }
  function field(palette, seed=0, warp=null, snapshot=null, contrast=1) {
    const labs=palette.map(toLab), pts=anchors(seed);
    return (x,y)=>{
      if(warp){const p=unwarpPoint(x,y,warp);x=p.x;y=p.y;}
      if(snapshot&&snapshot.model==='color-flow-v2'){const p=colorTransport(x,y,snapshot);x=p.x;y=p.y;}
      const value=[0,0,0]; let total=0;
      for(let i=0;i<pts.length;i++) {
        const weight=Math.pow(pts[i].weight*periodicWeight(x-pts[i].x,pts[i].rx,1.65)*periodicWeight(y-pts[i].y,pts[i].ry,1.64)+.00001,contrast);
        total+=weight;
        for(let j=0;j<3;j++)value[j]+=labs[pts[i].colorIndex % labs.length][j]*weight;
      }
      return fromLab(value.map(v=>v/total));
    };
  }
  function normalizeSettings(s={}) {
    const theme = 'album',viewMode=s.viewMode==='lyrics'?'lyrics':'normal';
    const duo=s.width===953&&s.height===671;
    return {width:duo?953:W,height:duo?671:H,theme,viewMode,preset:['ambient','original','balanced','lyrics','custom'].includes(s.preset)?s.preset:'balanced',
      coverOpacity:clamp(finite(s.coverOpacity,0)),meshOpacity:clamp(finite(s.meshOpacity,1)),
      veilOpacity:clamp(finite(s.veilOpacity,.08)),blur:clamp(finite(s.blur,36),0,160),
      seed:Math.round(clamp(finite(s.seed,0),0,9999)),
      coverSeed:Math.round(clamp(finite(s.coverSeed,0),0,4294967295)),pointVariation:clamp(finite(s.pointVariation,.6)),
      palette:Array.isArray(s.palette) && s.palette.length>=1?s.palette.slice(0,5).map(rgb):[],
      shaderId:typeof s.shaderId==='string'?s.shaderId:'',bpm:clamp(finite(s.bpm,150),40,200),
      motionAmount:clamp(finite(s.motionAmount,100),0,180),sensitivity:clamp(finite(s.sensitivity,1),.5,2.5),
      channelMix:Object.fromEntries(['bass','vocal','drums','instruments'].map(k=>[k,clamp(finite(s.channelMix&&s.channelMix[k],1),0,2)])),
      meshBlendMode:['NORMAL','SOFT_LIGHT','HARD_LIGHT'].includes(s.meshBlendMode)?s.meshBlendMode:'NORMAL'};
  }
  function preset(name) {
    if(name==='original')return {preset:name,coverOpacity:.64,meshOpacity:.8,veilOpacity:.8,blur:80};
    if(name==='lyrics')return {preset:name,coverOpacity:0,meshOpacity:1,veilOpacity:.04,blur:20};
    if(name==='balanced')return {preset:name,coverOpacity:0,meshOpacity:1,veilOpacity:.08,blur:36};
    return {preset:'ambient',coverOpacity:0,meshOpacity:1,veilOpacity:.12,blur:52};
  }
  // Preserve the shader's coordinate units and attach colour to each moving point.
  function shaderAssignments(definitions,palette,seed=0,defaults={},settings={},snapshot=null) {
    const {width,height}=normalizeSettings(settings);
    if(!palette.length) throw new Error('먼저 앨범 커버에서 색상을 추출해 주세요.');
    palette=ambientPalette(palette);
    const captured=normalizeSnapshot(snapshot),sample=field(palette,seed,null,captured,FIELD_CONTRAST), properties={}, ids=Object.keys(definitions||{});
    const slots=ids.filter(id=>['COLOR','COLOR_POINT','GRADIENT'].includes(definitions[id].type));
    if(!slots.length) throw new Error('이 Shader에는 편집 가능한 색상이 없습니다. Mesh gradient fill을 선택해 주세요.');
    const flow=captured&&captured.model!=='color-flow-v2'?motionFlow(captured.time,captured.bass,captured.hit,captured.strength):null;
    if(flow&&!slots.some(id=>definitions[id].type==='COLOR_POINT'))
      throw new Error('현재 포인트를 저장하려면 COLOR_POINT를 지원하는 Mesh gradient를 선택해 주세요.');
    const pointValues=slots.filter(id=>definitions[id].type==='COLOR_POINT').map(id=>defaults[id]||definitions[id].defaultValue).filter(v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y));
    // A captured grid can cross the viewport edge. Its span still expresses
    // the original units; using the largest absolute coordinate alone would
    // misread a 120% point as pixels when this fill is reused later.
    const extent=axis=>{const values=pointValues.map(v=>v[axis]);return values.length>=16?Math.max(...values)-Math.min(...values):Math.max(1,...values.map(Math.abs));};
    const maxX=extent('x'),maxY=extent('y');
    const infer=v=>pointValues.length>=16?(v<=2.5?1:v<=250?100:null):(v<=1.5?1:v<=100.001?100:null);
    const hints=settings.coordinateUnits||{};
    const unitX=[1,100,W,953].includes(hints.x)?hints.x:infer(maxX)||W,unitY=[1,100,H,671].includes(hints.y)?hints.y:infer(maxY)||H;
    const outputX=unitX===1||unitX===100?unitX:width,outputY=unitY===1||unitY===100?unitY:height;
    const warp=layoutWarp({...settings,seed}),points=[];
    const padX=flow?Math.abs(flow.x)+Math.abs(flow.shearX)+.04:0,padY=flow?Math.abs(flow.y)+Math.abs(flow.shearY)+.02:0;
    slots.forEach((id,index)=>{
      const def=definitions[id], value=defaults[id]||def.defaultValue;
      if(def.type==='COLOR_POINT') {
        if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y))
          throw new Error('Shader의 색상 포인트 좌표를 읽을 수 없습니다. Figma 기본 Mesh gradient를 사용해 주세요.');
        const before={x:value.x/unitX,y:value.y/unitY},source={...before};
        // Figma's finite mesh cannot fill the area vacated by moving borders.
        // Extend only boundary control points; interior points keep the exact
        // displayed flow. Sample the extended field for those guard colours.
        if(flow){
          if(source.x<=0)source.x=Math.min(source.x,-padX);else if(source.x>=1)source.x=Math.max(source.x,1+padX);
          if(source.y<=0)source.y=Math.min(source.y,-padY);else if(source.y>=1)source.y=Math.max(source.y,1+padY);
        }
        const base=warpPoint(source.x,source.y,warp),after=flow?flowPoint(base.x,base.y,flow):base;
        properties[id]={x:after.x===before.x&&outputX===unitX?value.x:after.x*outputX,y:after.y===before.y&&outputY===unitY?value.y:after.y*outputY,color:sample(source.x,source.y)};
        points.push({id,before,after,edgeExtended:source.x!==before.x||source.y!==before.y,movePx:Math.hypot((after.x-before.x)*width,(after.y-before.y)*height)});
      } else if(def.type==='GRADIENT') {
        properties[id]={stops:palette.map((c,i)=>({position:i/Math.max(1,palette.length-1),color:{...(captured&&captured.model==='color-flow-v2'?sample(i/Math.max(1,palette.length-1),.5):c),a:1}}))};
      } else {
        // Built-in 4×4 colour slots, with fallback for custom 3–5 colour shaders.
        const m=(def.name||'').match(/(?:color|colour|색상|색)\s*[_-]?\s*(\d+)/i);
        const n=m?Math.max(0,Number(m[1])-1):index;
        properties[id]=slots.length===16?sample((n%4)/3,Math.floor(n/4)/3):captured&&captured.model==='color-flow-v2'?sample(index/Math.max(1,slots.length-1),.5):palette[index%palette.length];
      }
    });
    return {properties,mapped:slots.length,geometry:{points,coordinateUnits:{x:outputX,y:outputY},edgeExtendedPoints:points.filter(p=>p.edgeExtended).length,movedPoints:points.filter(p=>p.movePx>.01).length,maxMovePx:Math.max(0,...points.map(p=>p.movePx))}};
  }
  function compositeWeights(s) {
    return {veil:s.veilOpacity,mesh:s.meshOpacity*(1-s.veilOpacity),
      cover:s.coverOpacity*(1-s.meshOpacity)*(1-s.veilOpacity),
      base:(1-s.coverOpacity)*(1-s.meshOpacity)*(1-s.veilOpacity)};
  }
  return {W,H,FIELD_CONTRAST,clamp,finite,rgb,toLab,fromLab,toLch,fromLch,albumTokens,ambientPalette,periodicWeight,hex,parseHex,extractPalette,anchors,coverSeed,layoutWarp,warpPoint,unwarpPoint,motionFlow,flowPoint,unflowPoint,normalizeSnapshot,colorPhases,colorTransport,field,normalizeSettings,preset,shaderAssignments,compositeWeights};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=AlbumMesh;

/* Figma sandbox. No document writes until an explicit preview/create action. */
(function () {
  'use strict';
  const M=AlbumMesh, shaderCache=new Map(),appliedShaders=new Map();
  let busy=false, lastCreated=null;
  const send=(type,body={})=>figma.ui.postMessage({type,...body});
  const error=(e)=>e && e.message ? e.message : String(e);
  const bytes=(v)=>v instanceof Uint8Array?v:new Uint8Array(v||[]);
  const solid=(color,opacity=1)=>({type:'SOLID',color,opacity});
  function coordinateUnits(node){
    try{return JSON.parse(node.getSharedPluginData('rhime_mesh_gradient','coordinateUnits')||'null');}catch(e){return null;}
  }
  function selectedCover() {
    const nodes=figma.currentPage.selection;
    return {count:nodes.length,name:nodes.length===1?nodes[0].name:''};
  }
  function discoverAppliedShaders() {
    appliedShaders.clear();
    const queue=[...figma.currentPage.selection,...figma.currentPage.children],seen=new Set();
    for(let i=0;i<queue.length&&i<18000;i++) {
      const node=queue[i];if(!node||seen.has(node.id))continue;seen.add(node.id);
      if('fills'in node&&Array.isArray(node.fills))for(const fill of node.fills) {
        if(fill.type==='SHADER'&&!appliedShaders.has(fill.id))appliedShaders.set(fill.id,{id:fill.id,name:node.name||'파일의 Shader',fill,coordinateUnits:coordinateUnits(node)});
      }
      if('children'in node)queue.push(...node.children);
    }
  }
  function inferDefinitions(properties) {
    const defs={};let point=0,color=0;
    for(const id of Object.keys(properties||{})) {
      const v=properties[id];
      if(v&&typeof v==='object'&&typeof v.x==='number'&&typeof v.y==='number'&&v.color)
        defs[id]={name:'Color point '+(++point),type:'COLOR_POINT',defaultValue:v};
      else if(v&&typeof v==='object'&&typeof v.r==='number'&&typeof v.g==='number'&&typeof v.b==='number')
        defs[id]={name:'Color '+(++color),type:'COLOR',defaultValue:v};
      else if(v&&Array.isArray(v.stops))defs[id]={name:'Gradient',type:'GRADIENT',defaultValue:v};
    }
    return defs;
  }
  async function shaders() {
    discoverAppliedShaders();
    if(typeof figma.listAvailableShaders!=='function'||typeof figma.importShaderById!=='function') {
      if(!appliedShaders.size){send('shaders',{shaders:[],reason:'이 Figma 환경에서 Shader Plugin API를 사용할 수 없습니다. Figma를 업데이트한 뒤 다시 실행해 주세요.'});return;}
    }
    let list=[],listError='';
    try{if(typeof figma.listAvailableShaders==='function')list=await figma.listAvailableShaders();}catch(e){listError=error(e);}
    const available=list.filter(s=>s.type==='fill').map(s=>({id:s.id,name:s.name,imported:s.imported}));
    // Built-in fills can be omitted by listAvailableShaders in desktop. An
    // existing applied paint is already materialized and can be copied natively.
    for(const applied of appliedShaders.values())if(!available.some(s=>s.id===applied.id)) {
      const n=Object.keys(inferDefinitions(applied.fill.properties)).length;
      available.push({id:applied.id,name:applied.name+' · 파일의 Shader'+(n===16?' (16색)':''),imported:true});
    }
    send('shader-diagnostics',{summary:'Shader 목록 API: '+list.length+'개\n현재 페이지에서 발견: '+appliedShaders.size+'개'+(listError?'\n'+listError:'')});
    send('shaders',{shaders:available,reason:available.length?'':listError});
  }
  async function getShader(id) {
    if(!id)throw new Error('파일에서 Mesh gradient fill을 한 번 적용하고 Shader 목록을 새로고침해 주세요.');
    if(shaderCache.has(id))return shaderCache.get(id);
    if(appliedShaders.has(id)) {
      const template=appliedShaders.get(id),definitions=inferDefinitions(template.fill.properties);
      if(Object.keys(definitions).length) {
        const info={id,name:template.name+' · Native Shader',definitions,defaults:template.fill.properties||{},coordinateUnits:template.coordinateUnits,source:'existing-paint'};
        shaderCache.set(id,info);return info;
      }
    }
    if(typeof figma.importShaderById!=='function')throw new Error('Shader Plugin API를 지원하는 Figma 버전이 필요합니다.');
    const ready=await figma.importShaderById(id);
    if(ready.type!=='fill')throw new Error('Shader effect가 아닌 Shader fill을 선택해 주세요.');
    let temp;
    try {
      temp=figma.createRectangle();temp.name='Album Mesh · temporary shader inspection';
      temp.resize(M.W,M.H);temp.x=-100000;temp.y=-100000;
      temp.fills=[{type:'SHADER',id:ready.id}];
      const fill=temp.fills[0];
      const info={id:ready.id,name:ready.name,definitions:ready.propertyDefinitions||{},defaults:fill.properties||{}};
      shaderCache.set(id,info);
      return info;
    } finally { if(temp&&!temp.removed)temp.remove(); }
  }
  function rect(parent,name,fills) {
    const n=figma.createRectangle();parent.appendChild(n);
    n.name=name;n.resize(parent.width,parent.height);n.x=0;n.y=0;n.fills=fills;
    n.constraints={horizontal:'STRETCH',vertical:'STRETCH'};
    return n;
  }
  async function background(message,temporary=false) {
    const s=M.normalizeSettings(message.settings),tokens=M.albumTokens(s.palette);
    const snapshot=M.normalizeSnapshot(message.snapshot);
    if(s.palette.length!==5)throw new Error('5개의 팔레트 색상이 필요합니다. 커버를 다시 불러와 주세요.');
    const coverBytes=bytes(message.coverBytes);
    if(!coverBytes.length||coverBytes.length>24*1024*1024)throw new Error('앨범 커버 이미지가 없거나 너무 큽니다.');
    const composite=message.renderer==='composite';
    let shader,assignment,meshPaint;
    if(composite) {
      const b=bytes(message.compositeBytes);
      if(!b.length||b.length>24*1024*1024)throw new Error('캡처한 프리뷰 이미지가 없거나 너무 큽니다.');
      meshPaint={type:'IMAGE',imageHash:figma.createImage(b).hash,scaleMode:'FILL',opacity:1};
    } else if(message.renderer==='raster') {
      const b=bytes(message.meshBytes);
      if(!b.length||b.length>24*1024*1024)throw new Error('정적 Mesh 이미지가 없습니다.');
      meshPaint={type:'IMAGE',imageHash:figma.createImage(b).hash,scaleMode:'FILL',opacity:s.meshOpacity};
    } else {
      shader=await getShader(s.shaderId);
      assignment=M.shaderAssignments(shader.definitions,s.palette,s.seed,shader.defaults,{...s,coordinateUnits:shader.coordinateUnits},snapshot);
      meshPaint={type:'SHADER',id:shader.id,properties:{...shader.defaults,...assignment.properties},opacity:s.meshOpacity};
    }
    const coverHash=composite?null:figma.createImage(coverBytes).hash;
    let frame;
    try {
      frame=figma.createFrame();
      frame.name='Album Mesh / '+(s.viewMode==='lyrics'?'Lyrics':'Now Playing')+' / '+(composite?'Preview PNG':message.renderer==='raster'?'Static PNG':'Native Shader');
      if(snapshot)frame.name+=' / Snapshot';
      frame.resize(s.width,s.height);frame.clipsContent=true;frame.fills=[solid(tokens.base)];
      if(typeof frame.setSharedPluginData==='function')frame.setSharedPluginData('rhime_mesh_gradient','colorTokens',JSON.stringify(tokens));
      if(typeof frame.setSharedPluginData==='function')frame.setSharedPluginData('rhime_mesh_gradient','settings',JSON.stringify(s));
      const center=figma.viewport.center;
      const previous=lastCreated&&!lastCreated.removed&&lastCreated.parent===figma.currentPage?lastCreated:null;
      // Keep the generated background clear of the user's existing designs.
      let rightEdge=center.x-s.width/2-48;
      if(!temporary)for(const sibling of figma.currentPage.children) {
        if(sibling===frame||sibling.visible===false)continue;
        const box=sibling.absoluteBoundingBox;
        if(box&&Number.isFinite(box.x+box.width))rightEdge=Math.max(rightEdge,box.x+box.width);
      }
      frame.x=temporary?-100000:Math.round(rightEdge+48);
      frame.y=temporary?-100000:Math.round(previous?previous.y:center.y-s.height/2);
      let mesh;
      if(composite) {
        // Already composited in the preview. Applying opacity, a veil or blur
        // here would change the very pixels the user chose to capture.
        mesh=rect(frame,'01 · Preview snapshot · '+s.width+' × '+s.height,[meshPaint]);
      } else {
      rect(frame,'01 · Album cover · '+Math.round(s.coverOpacity*100)+'%',[
        {type:'IMAGE',imageHash:coverHash,scaleMode:'FILL',opacity:s.coverOpacity}]);
      mesh=rect(frame,'02 · Mesh · '+(shader?'Native Shader':'Static PNG'),[meshPaint]);
      if(assignment&&typeof mesh.setSharedPluginData==='function')mesh.setSharedPluginData('rhime_mesh_gradient','coordinateUnits',JSON.stringify(assignment.geometry.coordinateUnits));
      mesh.blendMode=s.meshBlendMode;
      const veil=rect(frame,'03 · Veil + Background blur',[solid(tokens.base,s.veilOpacity)]);
      if(s.blur>0)veil.effects=[{type:'BACKGROUND_BLUR',radius:s.blur,visible:true}];
      }
      // Imported local development plugins can run without a registered ID.
      // Figma only permits private plugin data for registered plugins; JSON
      // export in the UI remains available in both environments.
      if(figma.pluginId) {
        frame.setPluginData('albumMesh',JSON.stringify({version:"1.11.0",settings:s,tokens,snapshot,renderer:composite?'composite':shader?'native':'raster',sourceName:message.sourceName||'Album cover'}));
        mesh.setPluginData('albumMeshMotion',JSON.stringify({model:'color-flow-v2',analysis:'four spectral/timbre proxies, not separated stems',channels:['bass','vocal','drums','instruments'],channelMix:s.channelMix,bpmGuide:s.bpm,flowStrengthPercent:s.motionAmount,sensitivity:s.sensitivity,lowBandHz:[35,180],vocalBandHz:[300,3200],percussiveBandHz:[1200,8000],attackMs:22,releaseMs:Math.max(90,Math.min(200,60000/s.bpm*.36)),note:'Motion reference only. Audio synchronization is not embedded in Figma.'}));
      }
      if(temporary) {
        const png=await frame.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});
        return {png,snapshot,mapped:assignment?assignment.mapped:0,geometry:assignment?assignment.geometry:null,shaderName:shader?shader.name:''};
      }
      figma.currentPage.selection=[frame];figma.viewport.scrollAndZoomIntoView([frame]);
      lastCreated=frame;figma.commitUndo();
      return {nodeId:frame.id,width:s.width,height:s.height,snapshot,mapped:assignment?assignment.mapped:0,geometry:assignment?assignment.geometry:null,shaderName:shader?shader.name:''};
    } catch(e) { if(frame&&!frame.removed)frame.remove();throw e; }
    finally { if(temporary&&frame&&!frame.removed)frame.remove(); }
  }
  async function readSelection() {
    const selected=figma.currentPage.selection;
    if(selected.length!==1)throw new Error('앨범 커버 레이어 하나를 선택해 주세요.');
    const node=selected[0];
    let b;
    const fill='fills'in node && Array.isArray(node.fills)?node.fills.find(p=>p.type==='IMAGE'&&p.visible!==false&&p.imageHash):null;
    if(fill) {
      const img=figma.getImageByHash(fill.imageHash);
      if(!img)throw new Error('이미지를 읽을 수 없습니다. 파일로 불러와 주세요.');
      b=await img.getBytesAsync();
    } else if('exportAsync'in node) {
      b=await node.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:1024}});
    } else throw new Error('이 레이어를 이미지로 읽을 수 없습니다.');
    if(b.length>24*1024*1024)throw new Error('커버가 너무 큽니다. 24MB 이하의 이미지 파일로 불러와 주세요.');
    send('cover',{bytes:b,name:node.name});
  }
  figma.ui.onmessage=async function(message) {
    if(!message||typeof message.type!=='string')return;
    if(message.type==='init') {
      send('selection',selectedCover());
      try {await shaders();}catch(e){send('shaders',{shaders:[],reason:error(e)});}
      return;
    }
    if(message.type==='refresh-shaders') {
      shaderCache.clear();
      try{await shaders();}catch(e){send('shaders',{shaders:[],reason:error(e)});}
      return;
    }
    if(busy){send('error',{message:'이전 작업이 끝난 뒤 다시 시도해 주세요.'});return;}
    busy=true;
    try {
      if(message.type==='use-selection')await readSelection();
      else if(message.type==='inspect-shader') {
        const s=await getShader(message.id);
        send('shader-info',{shader:s});
      } else if(message.type==='create') {
        const result=await background(message,false);send('created',result);
        figma.notify(result.width+' × '+result.height+' Album Mesh 배경을 만들었습니다.');
      } else if(message.type==='native-preview') {
        const result=await background(message,true);send('native-preview',{...result,revision:message.revision});
      }
    } catch(e) {send('error',{message:error(e),request:message.type});}
    finally {busy=false;}
  };
  figma.on('selectionchange',()=>send('selection',selectedCover()));
  figma.showUI(__html__,{width:960,height:820,themeColors:true,title:'Album Mesh'});
})();
