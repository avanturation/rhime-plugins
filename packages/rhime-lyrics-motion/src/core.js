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
