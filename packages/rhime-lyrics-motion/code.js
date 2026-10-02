/* Shared LRC timing and native Motion track planner. */
var LyricsMotion=(function(){
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const num=(v,d)=>typeof v==='number'&&Number.isFinite(v)?v:d;
  const time=v=>Math.round(v*1e6)/1e6;
  function parse(input){
    if(typeof input!=='string'||input.length>262144)throw new Error('256KB 이하의 LRC를 사용해 주세요.');
    const events=[],warnings=[],metadata={};let offset=0;
    input.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((raw,index)=>{
      let line=raw.trim();if(!line)return;
      const meta=line.match(/^\[([a-z]+):(.*?)\]$/i);
      if(meta){if(meta[1].toLowerCase()==='offset'){
        if(!/^[+-]?\d+$/.test(meta[2]))throw new Error(`${index+1}행: offset은 밀리초 정수여야 합니다.`);
        offset=Number(meta[2])/1000;
      }else metadata[meta[1].toLowerCase()]=meta[2];return;}
      const stamps=[];let match;
      while((match=line.match(/^\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/))){
        const seconds=Number(match[1])*60+Number(match[2])+(match[3]?Number(match[3])/10**match[3].length:0);
        if(seconds>7200)throw new Error(`${index+1}행: 2시간 이내의 타임스탬프가 필요합니다.`);
        stamps.push(seconds);line=line.slice(match[0].length);
      }
      if(!stamps.length){
        if(/^\[\d/.test(line))throw new Error(`${index+1}행: [분:초.소수] 시간을 확인해 주세요.`);
        warnings.push(`${index+1}행: 시간이 없는 줄은 제외했습니다.`);return;
      }
      if(/<\d+:\d+(?:\.\d+)?>/.test(line)){line=line.replace(/<\d+:\d+(?:\.\d+)?>/g,'');warnings.push(`${index+1}행: 단어 시간 대신 줄 시간을 사용합니다.`);}
      for(const start of stamps)events.push({start,text:line.trim()});
    });
    if(!events.some(e=>e.text))throw new Error('시간과 가사가 있는 LRC를 입력해 주세요.');
    if(events.length>400)throw new Error('한 번에 최대 400개의 타임스탬프를 지원합니다.');
    const merged=[];
    for(const event of events.map(e=>({...e,start:time(Math.max(0,e.start+offset))})).sort((a,b)=>a.start-b.start)){
      const last=merged.at(-1);
      if(last&&last.start===event.start){
        if(event.text&&!last.text.split('\n').includes(event.text))last.text=last.text?last.text+'\n'+event.text:event.text;
      }else merged.push({...event});
    }
    return {cues:merged,warnings,metadata,offset};
  }
  const defaultBezier={x1:.42,y1:0,x2:.58,y2:1};
  function normalize(v={}){
    const width=Math.round(clamp(num(v.width,402),240,1440)),height=Math.round(clamp(num(v.height,874),240,1600));
    const fontSize=clamp(num(v.fontSize,36),16,72);
    return {width,height,fontSize,lineHeight:clamp(num(v.lineHeight,Math.round(fontSize*1.22)),fontSize,144),
      weight:Math.round(clamp(num(v.weight,600),100,900)),margin:clamp(num(v.margin,24),8,Math.min(120,width/3)),
      gap:clamp(num(v.gap,28),0,100),focus:clamp(num(v.focus,42),15,80),
      inactive:clamp(num(v.inactive,.32),0,1),blur:clamp(num(v.blur,3),0,20),
      transition:clamp(num(v.transition,.46),.02,2),tail:clamp(num(v.tail,3),.1,30),mediaDuration:clamp(num(v.mediaDuration,0),0,7200),
      syncOffset:clamp(num(v.syncOffset,0),-60000,60000),fromFirst:v.fromFirst===true,
      bezier:Object.fromEntries(Object.entries(defaultBezier).map(([k,d])=>[k,clamp(num(v.bezier?.[k],d),0,1)])),
      color:/^#[\da-f]{6}$/i.test(v.color||'')?v.color.toUpperCase():'#F8F4F3'};
  }
  function timing(parsed,settings){
    const s=normalize(settings),cues=[];
    for(const c of parsed.cues){
      const start=time(Math.max(0,c.start+s.syncOffset/1000)),last=cues.at(-1);
      if(last&&last.sourceStart===start){if(c.text)last.text=last.text?last.text+'\n'+c.text:c.text;}
      else cues.push({sourceStart:start,text:c.text});
    }
    const origin=s.fromFirst?cues[0].sourceStart:0,end=cues.at(-1).sourceStart+s.tail;
    if(s.mediaDuration>end&&cues.at(-1).text)cues.push({sourceStart:time(end),text:''});
    return {cues:cues.map(c=>({...c,start:time(c.sourceStart-origin)})),origin,duration:time(Math.max(end,s.mediaDuration)-origin)};
  }
  const hold={type:'HOLD'};
  const key=(t,v,e=hold)=>({timelinePosition:time(t),value:{type:'FLOAT',value:v},easing:e.easingFunctionCubicBezier?{...e,easingFunctionCubicBezier:{...e.easingFunctionCubicBezier}}:{...e}});
  function track(base,keys){
    const sorted=[];
    for(const k of keys.sort((a,b)=>a.timelinePosition-b.timelinePosition)){
      if(sorted.length&&sorted.at(-1).timelinePosition===k.timelinePosition)sorted[sorted.length-1]=k;
      else sorted.push(k);
    }
    return {baseValue:{type:'FLOAT',value:base},keyframes:sorted};
  }
  function compile(parsed,settings,heights,positions){
    const s=normalize(settings),t=timing(parsed,s),rows=[];let y=0,hi=0;
    const easing={type:'CUSTOM_CUBIC_BEZIER',easingFunctionCubicBezier:{...s.bezier}};
    t.cues.forEach((c,i)=>{if(c.text){const height=num(heights&&heights[hi++],s.lineHeight);if(!(height>0&&height<10000))throw new Error('가사 높이를 계산하지 못했습니다.');rows.push({...c,cueIndex:i,y,height});y+=height+s.gap;}});
    if(positions){if(positions.length!==rows.length||positions.some((p,i)=>!Number.isFinite(p)||p<0||(i&&p<=positions[i-1])))throw new Error('가사 위치를 확인해 주세요.');rows.forEach((r,i)=>r.y=positions[i]);y=rows[rows.length-1].y+rows[rows.length-1].height+s.gap;}
    const rowByCue=new Map(rows.map(r=>[r.cueIndex,r]));
    const duration=t.duration,windows=t.cues.map((c,i)=>Math.min(s.transition,((t.cues[i+1]?.start??duration)-c.start)*.45));
    const scrollKeys=[key(0,0)];let previous=0;
    t.cues.forEach((c,i)=>{const row=rowByCue.get(i);if(!row)return;const target=-row.y;
      if(target!==previous){scrollKeys.push(key(c.start,previous,easing),key(c.start+windows[i],target));previous=target;}
    });
    scrollKeys.push(key(duration,previous));
    const outputRows=rows.map(r=>{
      const start=r.start,end=t.cues[r.cueIndex+1]?.start??duration,fadeInEnd=time(start+windows[r.cueIndex]);
      const fadeOutEnd=r.cueIndex+1<t.cues.length?time(end+windows[r.cueIndex+1]):null;
      const make=(idle,active)=>{
        const keys=[key(0,idle),key(start,idle,easing),key(fadeInEnd,active)];
        if(fadeOutEnd!==null)keys.push(key(end,active,easing),key(fadeOutEnd,idle));
        keys.push(key(duration,fadeOutEnd===null?active:idle));return track(idle,keys);
      };
      return {...r,end,opacity:make(s.inactive,1),blur:make(s.blur,0)};
    });
    return {settings:s,...t,rows:outputRows,contentHeight:Math.max(s.height,y-s.gap),baseY:s.height*s.focus/100,scroll:track(0,scrollKeys)};
  }
  function curve(x,points=defaultBezier){
    if(x<=0)return 0;if(x>=1)return 1;
    const bez=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3;
    let lo=0,hi=1;for(let i=0;i<28;i++){const m=(lo+hi)/2;if(bez(m,points.x1,points.x2)<x)lo=m;else hi=m;}
    return bez((lo+hi)/2,points.y1,points.y2);
  }
  const textKey=s=>s.normalize('NFKC').toLowerCase().replace(/[\s,，.!?？'’"“”]/g,'');
  function resolveRows(parsed,rows,manualTimes={}){
    const starts=rows.map(()=>null),anchored=rows.map(()=>false);let cursor=0;
    for(const cue of parsed.cues.filter(c=>c.text)){
      const i=rows.findIndex((r,i)=>i>=cursor&&textKey(r.text)===textKey(cue.text));
      if(i<0)throw new Error('디자인에서 가사를 찾지 못했습니다: '+cue.text.slice(0,48));
      starts[i]=cue.start;anchored[i]=true;cursor=i+1;
    }
    for(const [id,v] of Object.entries(manualTimes)){
      const i=rows.findIndex(r=>r.id===id);if(i<0)throw new Error('시간을 지정한 가사가 바뀌었습니다. 가사 뷰를 다시 읽어 주세요.');
      if(anchored[i]||v==null)continue;
      if(!Number.isFinite(v)||v<0||v>7200)throw new Error('가사 시간은 0~7200초 사이로 입력해 주세요.');starts[i]=time(v);
    }
    let previous=-1;
    for(const v of starts)if(v!==null){if(v<=previous)throw new Error('가사 시간은 디자인의 위에서 아래 순서대로 증가해야 합니다.');previous=v;}
    const additions=rows.flatMap((r,i)=>!anchored[i]&&starts[i]!==null?[{start:starts[i],text:r.text}]:[]);
    if(parsed.cues.length+additions.length>400)throw new Error('최대 400개의 타임스탬프를 지원합니다.');
    const effective={...parsed,cues:parsed.cues.concat(additions).sort((a,b)=>a.start-b.start)};
    if(additions.some(a=>parsed.cues.some(c=>c.start===a.start)))throw new Error('추가 가사는 기존 타임스탬프와 다른 시간을 지정해 주세요.');
    return {starts,anchored,parsed:effective};
  }
  function compileDesign(parsed,settings,preview,manualTimes={}){
    const resolved=resolveRows(parsed,preview.rows,manualTimes),indexes=resolved.starts.flatMap((v,i)=>v!==null?[i]:[]);
    const p=compile(resolved.parsed,settings,indexes.map(i=>preview.heights[i]),indexes.map(i=>preview.positions[i]));
    const timed=p.rows;let j=0;
    p.rows=preview.rows.map((r,i)=>resolved.starts[i]!==null?{...timed[j++],id:r.id,anchored:resolved.anchored[i],sourceStart:resolved.starts[i]}:
      {id:r.id,text:r.text,start:null,sourceStart:null,anchored:false,y:preview.positions[i],height:preview.heights[i],end:p.duration,
       opacity:track(p.settings.inactive,[key(0,p.settings.inactive),key(p.duration,p.settings.inactive)]),
       blur:track(p.settings.blur,[key(0,p.settings.blur),key(p.duration,p.settings.blur)])});
    p.contentHeight=Math.max(preview.height,...p.rows.map(r=>r.y+r.height));p.baseY=preview.baseY;
    p.untimed=p.rows.filter(r=>r.start===null).length;return p;
  }
  function valueAt(track,t){
    const keys=track.keyframes;let a=keys[0];
    if(t<a.timelinePosition)return track.baseValue.value;
    for(let i=1;i<keys.length;i++){
      const b=keys[i];if(t<b.timelinePosition){if(a.easing.type==='HOLD')return a.value.value;
        const p=(t-a.timelinePosition)/(b.timelinePosition-a.timelinePosition),v=a.easing.type==='LINEAR'?p:curve(p,a.easing.easingFunctionCubicBezier||defaultBezier);return a.value.value+(b.value.value-a.value.value)*v;}a=b;
    }return a.value.value;
  }
  function clock(seconds){const n=Math.round(seconds*100);return String(Math.floor(n/6000)).padStart(2,'0')+':'+String(Math.floor(n/100)%60).padStart(2,'0')+'.'+String(n%100).padStart(2,'0');}
  const rgb=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
  return {parse,normalize,timing,compile,compileDesign,resolveRows,textKey,valueAt,curve,clock,rgb};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=LyricsMotion;

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

/* Audio features are linear amplitudes, never clipped 0–255 display values. */
var AlbumMeshAudio=(function(){
  'use strict';
  const clamp=v=>Math.max(0,Math.min(1,v));
  function rms(samples){let sum=0;for(const n of samples)sum+=n*n;return Math.sqrt(sum/Math.max(1,samples.length));}
  function features(db,samples,sampleRate,fftSize){
    const band=(low,high)=>{const lo=Math.max(1,Math.ceil(low*fftSize/sampleRate)),hi=Math.min(db.length-1,Math.floor(high*fftSize/sampleRate));let sum=0;
      for(let i=lo;i<=hi;i++)sum+=Number.isFinite(db[i])?Math.pow(10,db[i]/10):0;
      return Math.sqrt(sum/Math.max(1,hi-lo+1));};
    // Harmonic concentration is only a timbre cue, not source separation.
    const tonality=(low,high)=>{const lo=Math.max(1,Math.ceil(low*fftSize/sampleRate)),hi=Math.min(db.length-1,Math.floor(high*fftSize/sampleRate));let power=0,log=0,count=0;
      for(let i=lo;i<=hi;i++){const v=Number.isFinite(db[i])?Math.max(1e-12,Math.pow(10,db[i]/10)):1e-12;power+=v;log+=Math.log(v);count++;}
      return count&&power>count*1e-11?clamp(1-Math.exp(log/count)/(power/count)):0;};
    const mid=band(300,3200),upper=band(3200,12000),body=band(180,800);
    return {rms:rms(samples),bass:band(35,180),percussion:band(1200,8000),
      vocal:mid*(.25+.75*tonality(300,3200)),instruments:Math.hypot(body*.55,upper*(.3+.7*tonality(3200,12000)))};
  }
  function createReactor(){
    const keys=['bass','percussion','vocal','instruments'],zeros=()=>Object.fromEntries(keys.map(k=>[k,0])),peaks=()=>Object.fromEntries(keys.map(k=>[k,1e-5]));
    let previous=zeros(),average=zeros(),peak=peaks(),vocal=0,instruments=0;
    let low=0,hit=0,bass=0,elapsed=0,lastHit=-1,events=0,warmed=false;
    function reset(){previous=zeros();average=zeros();peak=peaks();vocal=instruments=0;low=hit=bass=elapsed=events=0;lastHit=-1;warmed=false;}
    function update(input,dt=1/30,sensitivity=1,bpm=150){
      dt=Math.max(.001,Math.min(.1,dt));elapsed+=dt;
      const audible=Number.isFinite(input.rms)&&input.rms>.0008;
      const values=Object.fromEntries(keys.map(k=>[k,audible&&Number.isFinite(input[k])?Math.max(0,input[k]):0]));
      let onset=zeros(),levels=zeros(),level=0;
      for(const key of keys){
        const value=values[key];peak[key]=Math.max(value,peak[key]*Math.exp(-dt/2.5),1e-6);
        const rise=Math.max(0,value-previous[key])/peak[key];
        const accent=Math.max(0,value/Math.max(average[key],peak[key]*.22)-1.12);
        onset[key]=warmed&&audible?clamp((rise*3.2+accent*.28)*sensitivity):0;
        levels[key]=audible?clamp((value-peak[key]*.04)/(peak[key]*.96)*sensitivity):0;
        if(key==='bass')level=audible?clamp(value/peak[key]):0;
        average[key]+=(value-average[key])*(1-Math.exp(-dt/.32));previous[key]=value;
      }
      warmed=true;
      // A 150 BPM beat lasts 400 ms: settle before the next hit instead of
      // smoothing successive drums into a nearly constant displacement.
      const release=Math.max(.09,Math.min(.2,60/bpm*.36));
      low=Math.max(onset.bass,low*Math.exp(-dt/release));
      hit=Math.max(onset.percussion,onset.bass*.55,hit*Math.exp(-dt/(release*.72)));
      const target=audible?clamp(level*.28+low*.72):0;
      bass+=(target-bass)*(1-Math.exp(-dt/(target>bass?.022:.11)));
      if(!audible){low*=Math.exp(-dt/.08);hit*=Math.exp(-dt/.08);}
      // Sustain follows the envelope slowly; broad attacks belong to drums.
      const vocalTarget=levels.vocal*(1-onset.percussion*.45);
      const instTarget=levels.instruments*(1-onset.percussion*.6);
      vocal+=(vocalTarget-vocal)*(1-Math.exp(-dt/(audible?.28:.12)));
      instruments+=(instTarget-instruments)*(1-Math.exp(-dt/(audible?.48:.16)));
      const strike=Math.max(onset.bass,onset.percussion);
      if(strike>.28&&elapsed-lastHit>.09){events++;lastHit=elapsed;}
      return {bass,hit,drums:hit,vocal,instruments,level,onset:strike,events,rms:input.rms||0,audible};
    }
    return {update,reset};
  }
  return {rms,features,createReactor};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=AlbumMeshAudio;

/* The existing Album Mesh field and four audio proxies, on a seekable clock. */
var LyricsMesh=(function(){
  'use strict';
  const M=AlbumMesh,A=AlbumMeshAudio,clone=v=>JSON.parse(JSON.stringify(v));
  function config(value){
    const s=M.normalizeSettings(value&&value.settings||value);
    if(s.palette.length!==5)throw new Error('Mesh Gradient에서 저장한 설정 JSON을 불러오거나 Mesh Shader를 연결해 주세요.');
    return s;
  }
  function spectrum(samples){
    const n=samples.length,re=new Float64Array(n),im=new Float64Array(n);
    for(let i=0;i<n;i++){let j=0,k=i;for(let b=1;b<n;b<<=1){j=(j<<1)|(k&1);k>>=1;}re[j]=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));}
    for(let len=2;len<=n;len<<=1)for(let i=0;i<n;i+=len)for(let j=0;j<len/2;j++){
      const a=-2*Math.PI*j/len,c=Math.cos(a),s=Math.sin(a),p=i+j,q=p+len/2,x=re[q]*c-im[q]*s,y=re[q]*s+im[q]*c;
      re[q]=re[p]-x;im[q]=im[p]-y;re[p]+=x;im[p]+=y;
    }
    return Float32Array.from({length:n/2},(_,i)=>20*Math.log10(Math.max(1e-12,2*Math.hypot(re[i],im[i])/n)));
  }
  async function analyze(channels,sampleRate,settings,progress=()=>{},yieldTask=async()=>{}){
    if(!channels.length||!Number.isFinite(sampleRate)||sampleRate<8000)throw new Error('음악 파일을 분석하지 못했습니다.');
    const s=config(settings),duration=channels[0].length/sampleRate;
    if(!duration||duration>7200)throw new Error('2시간 이하의 음악 파일을 선택해 주세요.');
    const rate=30,count=Math.ceil(duration*rate)+1,reactor=A.createReactor(),samples=new Float32Array(2048),result=[];
    const v=[0,0,0,0],phases=[0,0,0,0],mix=[s.channelMix.bass,s.channelMix.vocal,s.channelMix.drums,s.channelMix.instruments];let flowTime=0;
    for(let i=0;i<count;i++){
      const t=Math.min(duration,i/rate),offset=Math.round(t*sampleRate)-samples.length/2;
      for(let j=0;j<samples.length;j++){let x=0;for(const c of channels)x+=c[offset+j]||0;samples[j]=x/channels.length;}
      const metric=reactor.update(A.features(spectrum(samples),samples,sampleRate,2048),1/rate,s.sensitivity,s.bpm),input=[metric.bass,metric.vocal,metric.hit,metric.instruments];
      for(let k=0;k<4;k++)v[k]+=(M.clamp(input[k]*mix[k])-v[k])*(1-Math.exp(-1/rate/[.14,.3,.09,.5][k]));
      if(metric.audible){flowTime+=1/rate;for(let k=0;k<4;k++)phases[k]+=v[k]/rate*[.9,.65,.8,.42][k];}
      result.push({at:t,time:flowTime,bass:v[0],vocal:v[1],hit:v[2],instruments:v[3],phases:phases.slice()});
      if(i%90===0){progress(i/count);await yieldTask();}
    }
    progress(1);return {duration,rate,frames:result};
  }
  function at(analysis,time,strength){
    const empty={time:0,bass:0,vocal:0,hit:0,instruments:0,phases:[0,0,0,0]};
    if(!analysis)return {model:'color-flow-v2',...empty,strength};
    const t=Math.max(0,Math.min(analysis.duration,time)),x=t*analysis.rate,i=Math.min(analysis.frames.length-1,Math.floor(x)),a=analysis.frames[i],b=analysis.frames[Math.min(i+1,analysis.frames.length-1)],p=Math.min(1,Math.max(0,(t-a.at)/Math.max(1e-9,b.at-a.at)));
    const value={model:'color-flow-v2',strength,phases:a.phases.map((n,k)=>n+(b.phases[k]-n)*p)};
    for(const k of ['time','bass','vocal','hit','instruments'])value[k]=a[k]+(b[k]-a[k])*p;return value;
  }
  function source(node){
    if(!node||!Array.isArray(node.fills))throw new Error('Mesh Shader가 있는 배경 레이어를 선택해 주세요.');
    const fillIndex=node.fills.findIndex(f=>f.type==='SHADER'&&f.visible!==false),fill=node.fills[fillIndex];
    if(!fill)throw new Error('PNG는 색상 키프레임을 만들 수 없습니다. Mesh Gradient의 별도 Shader 출력 레이어를 선택해 주세요.');
    const slots=Object.entries(fill.properties||{}).filter(([,v])=>v&&((Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.color)||(['r','g','b'].every(k=>Number.isFinite(v[k]))))).map(([id,v])=>({id,type:v.color?'COLOR_POINT':'COLOR'}));
    if(slots.length<3||slots.length>32)throw new Error('3~32개 색상 포인트가 있는 Mesh Shader가 필요합니다.');
    let parent=node,settings=null;
    while(parent){try{const v=JSON.parse(parent.getSharedPluginData('rhime_mesh_gradient','settings')||'null');if(v){settings=config(v);break;}}catch(_){}parent=parent.parent;}
    if(!settings){const data=new Uint8ClampedArray(slots.length*4);slots.forEach((p,i)=>{const c=fill.properties[p.id].color||fill.properties[p.id];['r','g','b'].forEach((k,j)=>data[i*4+j]=Math.round(c[k]*255));data[i*4+3]=255;});settings=M.normalizeSettings({palette:M.extractPalette(data,5)});}
    let units=null;try{units=JSON.parse(node.getSharedPluginData('rhime_mesh_gradient','coordinateUnits')||'null');}catch(_){}
    return {nodeId:node.id,name:node.name,fillIndex,fill:clone(fill),slots,settings,units,width:node.width,height:node.height,signature:JSON.stringify([node.id,fillIndex,fill.id,slots.map(s=>[s.id,fill.properties[s.id]])])};
  }
  function tracks(info,settings,analysis,origin,duration,width=info.width,height=info.height){
    const s=config(settings);if(!analysis||!Array.isArray(analysis.frames))throw new Error('음악 파일 분석이 필요합니다.');
    if(!Number.isFinite(origin)||origin<0||!Number.isFinite(duration)||duration<=0||duration>7200)throw new Error('배경 모션 시간을 확인해 주세요.');
    const points=info.slots.filter(p=>p.type==='COLOR_POINT').map(p=>info.fill.properties[p.id]);
    const unit=axis=>{if(info.units&&[1,100,402,874,953,671,info.width,info.height].includes(info.units[axis]))return info.units[axis];const values=points.map(p=>p[axis]),max=Math.max(1,...values.map(Math.abs));return max<=2.5?1:max<=125?100:axis==='x'?info.width:info.height;};
    const ux=unit('x'),uy=unit('y'),palette=M.ambientPalette(s.palette),warp=M.layoutWarp(s),count=Math.min(2000,Math.max(2,Math.ceil(duration*12))),output=[];
    for(let i=0;i<info.slots.length;i++){
      const slot=info.slots[i],v=info.fill.properties[slot.id],p=slot.type==='COLOR_POINT'?M.unwarpPoint(v.x/ux,v.y/uy,warp):{x:(i%4)/3,y:Math.floor(i/4)/Math.max(1,Math.ceil(info.slots.length/4)-1)};
      const position=slot.type==='COLOR_POINT'?{x:v.x*(ux===1||ux===100?1:width/info.width),y:v.y*(uy===1||uy===100?1:height/info.height)}:null;
      const value=t=>{const color={...M.field(palette,s.seed,null,at(analysis,t+origin,s.motionAmount),M.FIELD_CONTRAST)(p.x,p.y),a:1};return {type:slot.type,value:position?{...position,color}:color};};
      const keys=Array.from({length:count+1},(_,j)=>({timelinePosition:Math.round(duration*j/count*1e6)/1e6,value:value(duration*j/count),easing:{type:'LINEAR'}}));
      output.push({field:{type:'INDEXED_ITEM',collection:'fills',index:info.fillIndex,propertyId:slot.id},track:{baseValue:value(0),keyframes:keys}});
    }
    return output;
  }
  return {config,spectrum,analyze,at,source,tracks};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=LyricsMesh;

/* Read-only matching and transactional in-place Motion adapter. */
var LyricsDesign=(function(){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const normalizeText=s=>s.normalize('NFKC').toLowerCase().replace(/[\s,，.!?？'’"“”]/g,'');
  function localPoint(n,ancestor){let x=0,y=0,p=n;while(p&&p.id!==ancestor.id){x+=p.x||0;y+=p.y||0;p=p.parent;}if(!p)throw new Error('Design 모드로 전환한 뒤 가사 뷰를 읽어 주세요. Motion의 재생용 레이어는 적용 대상이 아닙니다.');return {x,y};}
  function inspect(root,parsed,settings,manualTimes={}){
    if(!root||root.type!=='FRAME')throw new Error('기존 가사 뷰 프레임 하나를 선택하거나 링크를 입력해 주세요.');
    const cues=LyricsMotion.timing(parsed,settings).cues.filter(c=>c.text);
    const wanted=new Set(cues.map(c=>normalizeText(c.text)));
    const all=root.findAll(n=>n.type==='TEXT'&&wanted.has(normalizeText(n.characters))&&n.visible!==false)
      .sort((a,b)=>localPoint(a,root).y-localPoint(b,root).y||localPoint(a,root).x-localPoint(b,root).x);
    const used=new Set(),texts=[];
    for(const cue of cues){const n=all.find(n=>!used.has(n.id)&&normalizeText(n.characters)===normalizeText(cue.text));
      if(!n)throw new Error('디자인에서 가사를 찾지 못했습니다: '+cue.text.slice(0,48));used.add(n.id);texts.push(n);}
    let strip=texts[0].parent;
    const within=(n,p)=>{while(n){if(n.id===p.id)return true;n=n.parent;}return false;};
    while(strip&&(!texts.every(n=>within(n,strip))))strip=strip.parent;
    if(!strip||strip.id===root.id||strip.type!=='FRAME')throw new Error('가사 텍스트들을 담은 별도 프레임이 필요합니다.');
    if(texts.length===1&&strip.parent&&strip.parent.id!==root.id&&strip.parent.type==='FRAME')strip=strip.parent;
    const topAnchor=texts[0],family=typeof topAnchor.fontName==='object'?topAnchor.fontName.family:null;
    const extra=strip.findAll(n=>n.type==='TEXT'&&n.visible!==false&&!used.has(n.id)&&typeof n.fontSize==='number'&&n.fontSize===topAnchor.fontSize&&(!family||n.fontName.family===family));
    texts.push(...extra);texts.sort((a,b)=>localPoint(a,strip).y-localPoint(b,strip).y);texts.forEach(n=>used.add(n.id));
    if(texts.length>400)throw new Error('가사 레이어는 최대 400줄까지 지원합니다.');
    const points=texts.map(n=>localPoint(n,strip)),first=points[0];
    if(points.some((p,i)=>i&&p.y<=points[i-1].y))throw new Error('가사는 위에서 아래 순서로 배치되어 있어야 합니다.');
    const viewport=strip.parent;
    if(!viewport||viewport.type!=='FRAME')throw new Error('가사 영역을 담은 프레임이 필요합니다.');
    // Do not animate the shared ancestor if it also contains unrelated UI.
    const outsiders=strip.findAll(n=>n.type==='TEXT'&&!used.has(n.id)&&typeof n.fontSize==='number'&&n.fontSize>=texts[0].fontSize);
    if(outsiders.length)throw new Error('가사 컨테이너에 다른 큰 텍스트가 있습니다. 가사 전용 프레임을 선택해 주세요.');
    const positions=points.map(p=>p.y-first.y),s=LyricsMotion.normalize(settings);
    const top=texts[0],paint=Array.isArray(top.fills)?top.fills.find(p=>p.type==='SOLID'):null;
    const area=localPoint(viewport,root);
    const preview={width:viewport.width,height:viewport.height,margin:strip.x+first.x,baseY:strip.y+first.y,background:{width:root.width,height:root.height,x:area.x,y:area.y},
      stripWidth:strip.width,positions,heights:texts.map(n=>n.height),fontName:top.fontName,fontSize:top.fontSize,
      lineHeight:top.lineHeight,color:paint?'#'+['r','g','b'].map(k=>Math.round(paint.color[k]*255).toString(16).padStart(2,'0')).join(''):'#FCFCFC',
      rows:texts.map((n,i)=>({id:n.id,text:n.characters,x:points[i].x-first.x,width:n.width,height:n.height,fontSize:n.fontSize,fontName:n.fontName,lineHeight:n.lineHeight,letterSpacing:n.letterSpacing}))};
    const signature=JSON.stringify({ids:texts.map(n=>n.id),positions,heights:preview.heights,strip:[strip.id,strip.x,strip.y,strip.width,strip.height],viewport:[viewport.id,viewport.width,viewport.height],chars:texts.map(n=>n.characters)});
    const plan=LyricsMotion.compileDesign(parsed,s,preview,manualTimes);
    preview.rows.forEach((r,i)=>{r.sourceStart=plan.rows[i].sourceStart;r.anchored=plan.rows[i].anchored;});
    return {root,strip,viewport,texts,plan,preview,signature};
  }
  const prop=name=>({type:'PROPERTY',name});
  const radius=i=>({type:'INDEXED_ITEM',collection:'effects',index:i,field:'RADIUS'});
  function binding(n,f){const t=n.manualKeyframeTracks||{};return f.type==='PROPERTY'?t[f.name]:f.collection==='fills'?t.fills?.[f.index]?.properties?.[f.propertyId]:t.effects&&t.effects[f.index]&&t.effects[f.index][f.field];}
  function snapshot(n,fields){return {id:n.id,opacity:n.opacity,fills:clone(n.fills),effects:clone(n.effects),clipsContent:n.clipsContent,tracks:fields.map(field=>({field,track:binding(n,field)?clone(binding(n,field)):null}))};}
  function restoreNode(n,state){
    for(const t of state.tracks)n.removeManualKeyframeTrack(t.field);
    n.opacity=state.opacity;n.fills=state.fills;n.effects=state.effects;
    if(typeof state.clipsContent==='boolean')n.clipsContent=state.clipsContent;
    for(const t of state.tracks)if(t.track)n.applyManualKeyframeTrack(t.field,t.track);
  }
  function apply(d,background=null){
    const {root,strip,viewport,texts,plan}=d;
    if(typeof strip.applyManualKeyframeTrack!=='function'||typeof root.setTimelineDuration!=='function')throw new Error('현재 Figma에서 Motion API를 사용할 수 없습니다.');
    const oldTimeline=root.timelines&&root.timelines[0];
    const indexes=texts.map(n=>{const i=n.effects.findIndex(e=>e.type==='LAYER_BLUR');return i<0?n.effects.length:i;});
    if(background&&[strip,viewport,...texts].some(n=>n.id===background.node.id))throw new Error('가사 레이어를 배경으로 사용할 수 없습니다. 배경 프레임이나 도형을 연결해 주세요.');
    const states=[snapshot(strip,[prop('TRANSLATION_Y')]),snapshot(viewport,[])].concat(texts.map((n,i)=>snapshot(n,[prop('OPACITY'),radius(indexes[i])])));
    if(background)states.push(snapshot(background.node,background.tracks.map(t=>t.field)));
    const backup={version:1,states,timeline:oldTimeline?clone(oldTimeline):null};
    // Store every original style before touching the first node; each per-node record stays below Figma's data limit.
    const previous=states.map(s=>{const n=[strip,viewport,...texts,...(background?[background.node]:[])].find(n=>n.id===s.id);return {n,state:s,backup:n.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-backup')};});
    const oldRootData=root.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-target');
    let changed=false;
    try{
      for(const p of previous)if(!p.backup)p.n.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-backup',JSON.stringify(p.state));
      const originalTarget=oldRootData?JSON.parse(oldRootData):{ids:[],timeline:backup.timeline};
      root.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-target',JSON.stringify({...originalTarget,ids:[...new Set(originalTarget.ids.concat(states.map(s=>s.id)))]}));
      changed=true;strip.clipsContent=false;viewport.clipsContent=true;
      // A progressive blur attached to moving content follows later lyrics and never clears.
      // Keep the existing fade in viewport coordinates, with no new Figma nodes.
      const movingBlur=strip.effects.filter(e=>e.type==='LAYER_BLUR'&&e.blurType==='PROGRESSIVE');
      if(movingBlur.length){
        const offset=p=>({x:(strip.x+p.x*strip.width)/viewport.width,y:(strip.y+p.y*strip.height)/viewport.height});
        viewport.effects=clone(viewport.effects).concat(movingBlur.map(e=>({...clone(e),startOffset:offset(e.startOffset),endOffset:offset(e.endOffset)})));
        strip.effects=strip.effects.filter(e=>!(e.type==='LAYER_BLUR'&&e.blurType==='PROGRESSIVE'));
      }
      // Motion's editor attaches easing to the incoming interval. The shared preview
      // planner stores outgoing easing, so move each curve to the next native key.
      const nativeTrack=track=>({...clone(track),keyframes:track.keyframes.map((k,i)=>({...clone(k),easing:clone(i?track.keyframes[i-1].easing:{type:'HOLD'})}))});
      strip.applyManualKeyframeTrack(prop('TRANSLATION_Y'),nativeTrack(plan.scroll));
      texts.forEach((n,i)=>{
        // Preserve each paint's RGB, but transfer static dimming to the Motion opacity track.
        n.fills=n.fills.map(p=>{if(p.type!=='SOLID')return p;const f=clone(p);if((f.opacity==null?1:f.opacity)<.999){f.opacity=1;if(f.boundVariables)delete f.boundVariables.color;}return f;});
        const effects=clone(n.effects),idx=indexes[i];
        if(idx===effects.length)effects.push({type:'LAYER_BLUR',radius:0,visible:true});else {effects[idx].radius=0;effects[idx].visible=true;}
        n.effects=effects;n.opacity=i===0?1:plan.settings.inactive;
        n.applyManualKeyframeTrack(prop('OPACITY'),nativeTrack(plan.rows[i].opacity));
        n.applyManualKeyframeTrack(radius(idx),nativeTrack(plan.rows[i].blur));
      });
      if(background){
        if(background.fills)background.node.fills=background.fills;
        for(const t of background.tracks)background.node.applyManualKeyframeTrack(t.field,t.track);
      }
      const timeline=root.timelines&&root.timelines[0];if(!timeline)throw new Error('Motion 타임라인이 생성되지 않았습니다.');
      const original=oldRootData?JSON.parse(oldRootData).timeline:oldTimeline;
      root.setTimelineDuration(timeline.id,Math.max(plan.duration,original?original.duration:0));
      return backup;
    }catch(e){
      if(changed){for(const p of previous)try{restoreNode(p.n,p.state);}catch(_){}if(oldTimeline)try{root.setTimelineDuration(oldTimeline.id,oldTimeline.duration);}catch(_){} }
      for(const p of previous)p.n.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-backup',p.backup);root.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-target',oldRootData);throw e;
    }
  }
  async function restore(root,getNode){
    const data=root.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-target');if(!data)throw new Error('이 프레임에는 복원할 가사 모션이 없습니다.');
    const target=JSON.parse(data),items=[];
    for(const id of target.ids){const n=await getNode(id);if(!n)throw new Error('복원할 레이어가 없어졌습니다.');const raw=n.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-backup');if(!raw)throw new Error('원본 스타일 정보가 없습니다.');items.push({n,state:JSON.parse(raw)});}
    for(const p of items)restoreNode(p.n,p.state);
    const current=root.timelines&&root.timelines[0];if(current)root.setTimelineDuration(current.id,target.timeline?target.timeline.duration:2);
    for(const p of items)p.n.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-backup','');root.setSharedPluginData('rhime_lyrics_motion','lyrics-motion-target','');
  }
  return {inspect,apply,restore,normalizeText,localPoint};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=LyricsDesign;

(function(){
  'use strict';
  const L=LyricsMotion,send=(type,data={})=>figma.ui.postMessage({type,...data});
  let busy=false;
  const error=e=>e&&e.message?e.message:String(e);
  function selection(){
    const nodes=figma.currentPage.selection,n=nodes.length===1?nodes[0]:null;
    return {count:nodes.length,name:n?.name,size:n&&n.type==='FRAME'?{width:n.width,height:n.height}:null};
  }
  figma.ui.onmessage=async m=>{
    if(!m||typeof m.type!=='string')return;
    try{
      if(m.type==='init'||m.type==='selection-size'){
        send(m.type==='init'?'selection':'selection-size',selection());
        if(m.type==='init')send('mesh-options',{items:(figma.currentPage.findAll?.(n=>Array.isArray(n.fills)&&n.fills.some(f=>f.type==='SHADER'))||[]).flatMap(n=>{try{const s=LyricsMesh.source(n);return [{id:n.id,name:(n.parent?.name||'')+' / '+n.name+' · '+s.slots.length+'색'}];}catch(_){return [];}})});
      }
      else if(m.type==='inspect-mesh'){
        const selected=m.nodeId?[await figma.getNodeByIdAsync(m.nodeId)]:figma.currentPage.selection;
        if(selected.length!==1)throw new Error('Mesh Shader 배경 레이어 하나를 선택해 주세요.');
        let n=selected[0];if(!n)throw new Error('연결할 Mesh 레이어를 찾지 못했습니다. 배경을 다시 선택해 주세요.');if(!Array.isArray(n.fills)||!n.fills.some(f=>f.type==='SHADER')){
          const children=n.findAll?.(c=>Array.isArray(c.fills)&&c.fills.some(f=>f.type==='SHADER'))||[];
          if(children.length!==1)throw new Error('별도 Shader 출력의 Mesh 레이어 하나를 선택해 주세요.');n=children[0];
        }
        send('mesh-info',{mesh:LyricsMesh.source(n)});
      }
      else if(m.type==='inspect-design'){
        const root=m.nodeId?await figma.getNodeByIdAsync(m.nodeId):figma.currentPage.selection[0];
        const d=LyricsDesign.inspect(root,L.parse(m.lrc),L.normalize(m.settings),m.manualTimes);
        send('design-info',{id:root.id,name:root.name,lines:d.texts.length,width:root.width,height:root.height,signature:d.signature,preview:d.preview,
          untimed:d.plan.untimed,restored:!!root.getSharedPluginData('rhime_lyrics_motion','lyrics-motion-target'),data:{root:root.id,scroller:d.strip.id,viewport:d.viewport.id,clips:[d.strip.clipsContent,d.viewport.clipsContent],lines:d.texts.length,untimed:d.plan.untimed,first:d.plan.cues[0].start,last:d.plan.cues.at(-1).start}});
      }
      else if(m.type==='apply-existing'){
        if(busy)throw new Error('이전 모션을 적용하는 중입니다.');busy=true;
        try{const root=await figma.getNodeByIdAsync(m.nodeId),d=LyricsDesign.inspect(root,L.parse(m.lrc),m.settings,m.manualTimes);
          if(d.signature!==m.signature)throw new Error('디자인이 바뀌었습니다. 가사 뷰를 다시 읽어 주세요.');
          let background=null;
          if(m.mesh){
            const sourceNode=await figma.getNodeByIdAsync(m.mesh.nodeId),info=LyricsMesh.source(sourceNode);
            if(info.signature!==m.mesh.signature)throw new Error('Mesh 배경이 바뀌었습니다. Shader를 다시 연결해 주세요.');
            const analysis=m.mesh.analysis;
            if(!analysis||analysis.rate!==30||!Number.isFinite(analysis.duration)||analysis.duration<=0||analysis.duration>7200||!Array.isArray(analysis.frames)||analysis.frames.length!==Math.ceil(analysis.duration*30)+1)throw new Error('음악 반응 데이터를 다시 분석해 주세요.');
            for(let i=0;i<analysis.frames.length;i++){
              const f=analysis.frames[i];if(!Number.isFinite(f.at)||Math.abs(f.at-Math.min(analysis.duration,i/30))>.00001)throw new Error('음악 반응 시간을 읽을 수 없습니다.');
              AlbumMesh.normalizeSnapshot({...f,model:'color-flow-v2',strength:100});
            }
            let inside=sourceNode;while(inside&&inside.id!==root.id)inside=inside.parent;
            const destination=inside?sourceNode:root;
            const destinationIndex=inside?info.fillIndex:0,paint={...info.fill,properties:{...info.fill.properties}};
            const tracks=LyricsMesh.tracks({...info,fillIndex:destinationIndex},m.mesh.settings,analysis,d.plan.origin,d.plan.duration,destination.width,destination.height);
            for(const t of tracks)paint.properties[t.field.propertyId]=t.track.baseValue.value;
            const fills=destination.fills.slice();fills[destinationIndex]=paint;
            background={node:destination,fills,tracks};
          }
          LyricsDesign.apply(d,background);figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);
          send('applied',{nodeId:root.id,name:root.name,lines:d.texts.length,untimed:d.plan.untimed,duration:d.plan.duration,meshTracks:background?.tracks.length||0,keyframes:d.plan.scroll.keyframes.length+d.plan.rows.reduce((n,r)=>n+r.opacity.keyframes.length+r.blur.keyframes.length,0)+(background?background.tracks.reduce((n,t)=>n+t.track.keyframes.length,0):0)});
          figma.notify('기존 가사 뷰에 LRC 모션을 적용했습니다. Motion 모드에서 재생하세요.');
        }finally{busy=false;}
      }
      else if(m.type==='restore-existing'){
        const root=await figma.getNodeByIdAsync(m.nodeId);if(!root)throw new Error('프레임을 찾지 못했습니다.');
        await LyricsDesign.restore(root,id=>figma.getNodeByIdAsync(id));send('restored');figma.notify('가사의 원본 스타일과 모션을 복원했습니다.');
      }
    }catch(e){send('error',{message:error(e),action:m.type});}
  };
  figma.on('selectionchange',()=>send('selection',selection()));
  figma.showUI(__html__,{width:980,height:840,themeColors:true,title:'Rhime Lyrics Motion'});
})();
