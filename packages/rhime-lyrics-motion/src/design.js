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
