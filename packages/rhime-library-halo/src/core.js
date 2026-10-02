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
