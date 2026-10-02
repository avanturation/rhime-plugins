/* Colour extraction shared by origin with Rhime Album Mesh; standalone copy, no runtime dependency. */
var LibraryColor = (function () {
  'use strict';
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
  return {clamp,rgb,toLab,fromLab,toLch,fromLch,hex,parseHex,extractPalette};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=LibraryColor;

/* Original Halo renderer: no React, Shader or Cult UI runtime dependency. */
var LibraryHalo = (function () {
  'use strict';
  const C = typeof LibraryColor !== 'undefined' ? LibraryColor : require('./color.js');
  const clamp = C.clamp;
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  function representative(palette) {
    if(!Array.isArray(palette)||!palette.length)throw new Error('커버의 색상을 추출하지 못했습니다.');
    // One vote per album. Prefer a prominent chromatic cluster to typography;
    // never average unrelated hues or invent colour for monochrome artwork.
    return {...palette.reduce((best,c,i) => {
      const lch=C.toLch(c),score=lch.c/(1+i*.55)+.012/(1+i);
      return score>best.score?{color:C.rgb(c),score}:best;
    },{color:C.rgb(palette[0]),score:-1}).color};
  }
  function aggregate(albums, limit=8) {
    const seen=new Set(),groups=[];
    for(const album of albums) {
      if(album.included===false)continue;
      if(seen.has(album.id))continue;
      seen.add(album.id);
      const color=C.rgb(album.color),lab=C.toLab(color);
      let near=groups.find(g=>distance(g.lab,lab)<.065);
      if(near){near.weight++;near.albumIds.push(album.id);}
      else groups.push({color,lab,weight:1,albumIds:[album.id]});
    }
    if(!groups.length)return [];
    const ranked=groups.sort((a,b)=>b.weight-a.weight),chosen=[ranked[0]];
    while(chosen.length<Math.min(limit,ranked.length)) {
      let next=null,score=-1;
      for(const g of ranked) {
        if(chosen.includes(g))continue;
        const value=Math.min(...chosen.map(v=>distance(g.lab,v.lab)))*Math.sqrt(g.weight);
        if(value>score){next=g;score=value;}
      }
      chosen.push(next);
    }
    const result=chosen.map(g=>({color:{...g.color},weight:0,albumIds:[]}));
    for(const group of ranked) {
      let k=0,best=Infinity;
      chosen.forEach((g,i)=>{const d=distance(g.lab,group.lab);if(d<best){best=d;k=i;}});
      result[k].weight+=group.weight;result[k].albumIds.push(...group.albumIds);
    }
    return result.sort((a,b)=>C.toLch(a.color).h-C.toLch(b.color).h);
  }
  function normalize(value={}) {
    return {width:Math.round(clamp(finite(value.width,260),96,1440)),height:56,
      strength:clamp(finite(value.strength,65),0,100),
      softness:clamp(finite(value.softness,60),0,100),seed:Math.round(clamp(finite(value.seed,0),0,99999)),
      theme:value.theme==='dark'?'dark':'light'};
  }
  function snapshot(settings,palette,phase=0) {
    if(!palette.length)throw new Error('앨범 커버를 먼저 불러와 주세요.');
    return {settings:normalize(settings),palette:palette.map(g=>({color:C.rgb(g.color),weight:Math.max(1,finite(g.weight,1)),albumIds:[...(g.albumIds||[])]})),phase:finite(phase,0)};
  }
  function borderTokens(palette) {
    const strongest=palette.reduce((best,g)=>{
      const v=C.toLch(g.color),score=v.c*Math.sqrt(g.weight||1);
      return score>best.score?{...v,score}:best;
    },{c:0,h:0,score:0});
    const tint=clamp(strongest.c/.06);
    return {light:C.hex(C.fromLch({l:.90,c:.016*tint,h:strongest.h})),
      dark:C.hex(C.fromLch({l:.30,c:.022*tint,h:strongest.h})),opacity:100,width:1};
  }
  // A Gaussian-convolved strip, rather than circular pools or a painted shell.
  // This mirrors the reference's two blurred, moving linear-gradient underlays.
  function erf(x) {
    const sign=x<0?-1:1,z=Math.abs(x),t=1/(1+.3275911*z);
    return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-z*z));
  }
  function coverage(x,left,right,sigma) {
    return Math.max(0,.5*(erf((x-left)/(Math.SQRT2*sigma))-erf((x-right)/(Math.SQRT2*sigma))));
  }
  function render(frame,scale=3) {
    const s=normalize(frame.settings);
    if(!frame.palette.length)throw new Error('팔레트가 비어 있습니다.');
    scale=clamp(Math.round(finite(scale,3)),1,3);
    const width=s.width*scale,height=56*scale,data=new Uint8ClampedArray(width*height*4);
    // Keep pigment chromatic. Softness comes from alpha, never a white RGB mix.
    const colors=frame.palette.map(g=>{
      const v=C.toLch(g.color);
      return C.fromLch({l:.70,c:Math.min(.24,v.c*1.35),h:v.h});
    });
    const n=colors.length,phase=finite(frame.phase,0),seed=s.seed,blur=56*(.22+.22*s.softness/100);
    const travel=t=>.5-.5*Math.cos(t*Math.PI*2);
    const offset=seed*.79,orderA=colors.map((_,i)=>colors[(i+seed)%n]);
    const orderB=colors.map((_,i)=>colors[(n-1-i+Math.floor(n/2)+seed)%n]);
    const strips=[
      {left:(-.08+.76*travel(phase/6+offset))*s.width,length:s.width*.68,top:56*.62,bottom:56*1.62,opacity:.52,colors:orderA},
      {left:(.65-.60*travel(phase/5+.25+offset))*s.width,length:s.width*.55,top:56*.78,bottom:56*1.55,opacity:.38,colors:orderB}
    ];
    const tables=strips.map(strip=>{
      const row=Array.from({length:width},(_,px)=>{
        const x=(px+.5)/scale;let r=0,g=0,b=0,alpha=0;
        strip.colors.forEach((c,i)=>{
          const left=strip.left+i*strip.length/n,right=strip.left+(i+1)*strip.length/n;
          const w=coverage(x,left,right,blur);alpha+=w;r+=w*c.r;g+=w*c.g;b+=w*c.b;
        });
        return {r:r/(alpha||1),g:g/(alpha||1),b:b/(alpha||1),alpha};
      });
      const vertical=Float32Array.from({length:height},(_,py)=>coverage((py+.5)/scale,strip.top,strip.bottom,blur));
      return {row,vertical,opacity:strip.opacity*s.strength/100};
    });
    for(let py=0;py<height;py++)for(let px=0;px<width;px++) {
      let r=0,g=0,b=0,alpha=0;
      for(const table of tables) {
        const color=table.row[px],a=clamp(color.alpha*table.vertical[py]*table.opacity);
        r=color.r*a+r*(1-a);g=color.g*a+g*(1-a);b=color.b*a+b*(1-a);alpha=a+alpha*(1-a);
      }
      const k=(py*width+px)*4,a=Math.round(alpha*255);
      if(a){data[k]=Math.round(clamp(r/alpha)*255);data[k+1]=Math.round(clamp(g/alpha)*255);data[k+2]=Math.round(clamp(b/alpha)*255);data[k+3]=a;}
    }
    return {width,height,data};
  }
  function outline(frame,raster) {
    // Read the actual captured colour field, including both moving strips and
    // their overlap. A separate palette gradient would drift out of alignment.
    const r=raster||render(frame),y=r.height-1;
    const gradientStops=Array.from({length:33},(_,i)=>{
      const position=i/32,x=Math.round(position*(r.width-1)),k=(y*r.width+x)*4;
      return {position,color:{r:r.data[k]/255,g:r.data[k+1]/255,b:r.data[k+2]/255,
        a:Math.min(1,r.data[k+3]/255*2.2)}};
    });
    return {type:'GRADIENT_LINEAR',gradientTransform:[[1,0,0],[0,1,0]],gradientStops,opacity:1};
  }
  function fingerprint(data) {
    let hash=2166136261;
    for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);
    return (hash>>>0).toString(16);
  }
  return {MAX_ALBUMS:100,representative,aggregate,normalize,snapshot,borderTokens,render,outline,fingerprint};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=LibraryHalo;

(function () {
  'use strict';
  const H=LibraryHalo;
  const send=(type,body={})=>figma.ui.postMessage({type,...body});
  const message=e=>e&&e.message?e.message:String(e);
  let importing=false,creating=false;
  function selection() {
    const nodes=figma.currentPage.selection,n=nodes.length===1?nodes[0]:null;
    return {count:nodes.length,size:n&&'width'in n?{width:n.width,height:n.height,name:n.name}:null};
  }
  function imageFill(node) {
    return 'fills'in node&&Array.isArray(node.fills)?node.fills.find(p=>p.type==='IMAGE'&&p.visible!==false&&p.imageHash):null;
  }
  async function importSelection() {
    if(importing)throw new Error('커버를 불러오는 중입니다.');
    const nodes=[...figma.currentPage.selection];
    if(!nodes.length)throw new Error('커버 레이어를 여러 개 선택해 주세요.');
    if(nodes.length>H.MAX_ALBUMS)throw new Error('한 번에 최대 100개까지 선택할 수 있습니다.');
    importing=true;
    try {
      for(let i=0;i<nodes.length;i++) {
        const node=nodes[i];
        try {
          const fill=imageFill(node);
          let bytes;
          if(fill){const image=figma.getImageByHash(fill.imageHash);if(!image)throw new Error('이미지를 읽을 수 없습니다.');bytes=await image.getBytesAsync();}
          else if('exportAsync'in node)bytes=await node.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:256}});
          else throw new Error('이미지로 읽을 수 없는 레이어입니다.');
          if(!bytes.length||bytes.length>24*1024*1024)throw new Error('24MB 이하의 이미지가 필요합니다.');
          send('cover',{bytes,name:node.name,index:i+1,total:nodes.length});
        } catch(e){send('import-warning',{name:node.name,message:message(e)});}
      }
    } finally {importing=false;send('import-complete');}
  }
  function rasterBytes(value,s) {
    const b=value instanceof Uint8Array?value:new Uint8Array(value||[]);
    if(b.length<24||b.length>12*1024*1024)throw new Error('저장할 PNG가 없거나 너무 큽니다.');
    if([137,80,78,71,13,10,26,10].some((n,i)=>b[i]!==n))throw new Error('올바른 PNG가 아닙니다.');
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(v.getUint32(16)!==s.width*3||v.getUint32(20)!==s.height*3)throw new Error('캡처 크기가 설정과 다릅니다. 다시 생성해 주세요.');
    return b;
  }
  async function create(m,outlineOnly=false) {
    if(creating)throw new Error('이전 배경을 만드는 중입니다.');
    creating=true;
    let frame;
    try {
      const s=H.normalize(m.settings),bytes=outlineOnly?null:rasterBytes(m.bytes,s);
      if(!Array.isArray(m.palette)||!m.palette.length||m.palette.length>8)throw new Error('커버 팔레트가 필요합니다.');
      const captured=H.snapshot(s,m.palette,m.phase),stroke=H.outline(captured);
      const meta={version:'1.2.0',settings:s,phase:captured.phase,
        palette:m.palette.map(g=>({hex:LibraryColor.hex(LibraryColor.rgb(g.color)),weight:g.weight,albumIds:g.albumIds})),
        albums:(Array.isArray(m.albums)?m.albums:[]).slice(0,H.MAX_ALBUMS).map(a=>({name:String(a.name||'').slice(0,200),color:LibraryColor.hex(LibraryColor.rgb(a.color))})),
        renderer:'transparent-halo-ribbons',scale:3,animatedInFigma:false,surfaceIncluded:false,borderIncluded:true,roundingIncluded:false,
        outlineOnly,outlineEditable:true,outlinePaint:stroke};
      const hash=outlineOnly?null:figma.createImage(bytes).hash;
      frame=outlineOnly?figma.createRectangle():figma.createFrame();
      frame.name=outlineOnly?'Rhime / Library Halo · Outline':'Rhime / Library Halo · Color + Outline';
      frame.resize(s.width,s.height);frame.fills=[];frame.strokes=[stroke];frame.strokeWeight=1;frame.strokeAlign='INSIDE';frame.cornerRadius=0;
      if(!outlineOnly){
        frame.clipsContent=true;
        const background=figma.createRectangle();frame.appendChild(background);
        background.name='Halo · transparent color layer';background.resize(s.width,s.height);background.x=0;background.y=0;
        background.fills=[{type:'IMAGE',imageHash:hash,scaleMode:'FILL'}];background.strokes=[];
        background.constraints={horizontal:'STRETCH',vertical:'STRETCH'};
      }
      frame.setSharedPluginData('rhime_library_halo','settings',JSON.stringify(meta));
      const center=figma.viewport.center;frame.x=Math.round(center.x-s.width/2);frame.y=Math.round(center.y-s.height/2);
      figma.currentPage.selection=[frame];figma.viewport.scrollAndZoomIntoView([frame]);
      send('created',{name:frame.name,outlineOnly});figma.notify(outlineOnly?'편집 가능한 Halo 아웃라인을 만들었습니다.':'색 레이어와 아웃라인을 만들었습니다.');
    } catch(e){if(frame&&!frame.removed)frame.remove();throw e;}
    finally{creating=false;}
  }
  figma.ui.onmessage=async m=>{
    if(!m||typeof m.type!=='string')return;
    try {
      if(m.type==='init')send('selection',selection());
      else if(m.type==='import-selection')await importSelection();
      else if(m.type==='selection-size')send('selection-size',selection());
      else if(m.type==='create')await create(m);
      else if(m.type==='create-outline')await create(m,true);
    } catch(e){send('error',{message:message(e),action:m.type});}
  };
  figma.on('selectionchange',()=>send('selection',selection()));
  figma.showUI(__html__,{width:940,height:790,themeColors:true,title:'Rhime Library Halo'});
})();
