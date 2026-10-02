(function(){
  'use strict';
  const L=LyricsMotion,$=id=>document.getElementById(id),post=m=>parent.postMessage({pluginMessage:m},'*');
  let settings=L.normalize(),parsed,plan,current=0,playing=false,last=0,busy=false,audioUrl=null,nativeHeights=null,toastTimer,dirty=false,target=null;
  let manualTimes={},meshSource=null,meshSettings=null,meshSettingsImported=false,audioAnalysis=null,audioChannels=null,audioRate=0,audioRevision=0,analyzing=false,meshRenderer=null;
  const meshGL=document.createElement('canvas');
  try{meshRenderer=createLyricsMeshRenderer(meshGL);}catch(e){console.warn(e.message);}
  const ids=['width','height','fontSize','lineHeight','gap','margin','focus','transition','syncOffset','tail','inactive','blur','color'];
  function notify(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5500);}
  function safe(fn){return async(...a)=>{try{await fn(...a);}catch(e){notify(e.message||String(e));}};}
  const bezierIds={x1:'bezierX1',y1:'bezierY1',x2:'bezierX2',y2:'bezierY2'},bezierPresets={bezierSoft:{x1:.22,y1:1,x2:.36,y2:1},bezierOriginal:{x1:.42,y1:0,x2:.58,y2:1},bezierLinear:{x1:0,y1:0,x2:1,y2:1}};
  function syncBezier(){
    const b=settings.bezier;for(const [k,id] of Object.entries(bezierIds))$(id).value=b[k];
    const x1=20+140*b.x1,y1=100-80*b.y1,x2=20+140*b.x2,y2=100-80*b.y2;
    $('bezierHandles').setAttribute('d',`M20 100L${x1} ${y1} M160 20L${x2} ${y2}`);
    $('bezierPath').setAttribute('d',`M20 100C${x1} ${y1} ${x2} ${y2} 160 20`);
    for(const [id,x,y] of [['bezierPoint1',x1,y1],['bezierPoint2',x2,y2]]){$(id).setAttribute('cx',x);$(id).setAttribute('cy',y);}
    $('bezierValue').textContent=`cubic-bezier(${b.x1}, ${b.y1}, ${b.x2}, ${b.y2})`;
    Object.entries(bezierPresets).forEach(([id,p])=>$(id).setAttribute('aria-pressed',String(Object.keys(p).every(k=>p[k]===b[k]))));
  }
  function setBezier(bezier){settings=L.normalize({...settings,bezier});syncBezier();rebuild();}
  function syncInputs(){syncBezier();ids.forEach(id=>{$(id).value=id==='transition'?Math.round(settings[id]*1000):id==='inactive'?Math.round(settings[id]*100):settings[id];});$('fromFirst').checked=settings.fromFirst;$('inactive').nextElementSibling.textContent=Math.round(settings.inactive*100)+'%';$('blur').nextElementSibling.textContent=settings.blur+'px';}
  function resize(){
    const availableW=Math.max(100,$('stage').clientWidth-24),availableH=Math.max(150,$('stage').clientHeight-24),scale=Math.min(availableW/settings.width,availableH/settings.height,1);
    $('phone').style.width=settings.width+'px';$('phone').style.height=settings.height+'px';$('phone').style.transform=`scale(${scale})`;
    $('phoneWrap').style.width=settings.width*scale+'px';$('phoneWrap').style.height=settings.height*scale+'px';
  }
  function rebuild(resetTime=false){
    if(!parsed)return;
    $('phoneWrap').classList.toggle('hidden',!target);$('emptyPreview').classList.toggle('hidden',!!target);$('play').disabled=$('scrub').disabled=$('first').disabled=!target;
    const strip=$('strip');strip.replaceChildren();strip.style.width=(target?target.preview.stripWidth:settings.width-settings.margin*2)+'px';strip.style.left=settings.margin+'px';
    const font=target?.preview.fontName,axes=font?.variationSettings;
    const timed=L.timing(parsed,settings),nodes=[];
    for(const c of target?target.preview.rows:timed.cues.filter(c=>c.text)){
      const p=document.createElement('div');p.className='lyric';p.textContent=c.text;p.style.fontSize=settings.fontSize+'px';p.style.lineHeight=settings.lineHeight+'px';p.style.fontWeight=settings.weight;p.style.width='100%';p.style.color=settings.color;p.style.textAlign='left';
      if(font)p.style.fontFamily=JSON.stringify(font.family)+',"Interlude Variable",sans-serif';
      if(axes)p.style.fontVariationSettings=Object.entries(axes).map(([k,v])=>`"${k}" ${v}`).join(',');
      if(target){const r=target.preview.rows[nodes.length];p.style.width=r.width+'px';p.style.left=r.x+'px';p.style.height=r.height+'px';p.style.fontSize=r.fontSize+'px';p.style.overflow='hidden';if(r.letterSpacing)p.style.letterSpacing=(r.letterSpacing.unit==='PERCENT'?r.fontSize*r.letterSpacing.value/100:r.letterSpacing.value)+'px';}
      p.style.position='relative';strip.appendChild(p);nodes.push(p);
    }
    const heights=nativeHeights&&nativeHeights.length===nodes.length?nativeHeights:nodes.map(n=>n.offsetHeight||settings.lineHeight);
    const clockSettings={...settings,mediaDuration:$('meshMotion').checked&&audioAnalysis?audioAnalysis.duration:0};
    plan=target?L.compileDesign(parsed,clockSettings,target.preview,manualTimes):L.compile(parsed,clockSettings,heights);
    nodes.forEach((n,i)=>{n.style.position='absolute';n.style.top=plan.rows[i].y+'px';});strip.style.height=plan.contentHeight+'px';
    $('sizeInfo').textContent=target?settings.width+' × '+settings.height:'—';$('scrub').max=plan.duration;
    $('lrcInfo').textContent=`${plan.rows.length}줄 · ${L.clock(parsed.cues[0].start)} → ${L.clock(parsed.cues.at(-1).start)}`+(parsed.warnings.length?` · 알림 ${parsed.warnings.length}개: ${parsed.warnings[0]}`:'');
    $('timingInfo').textContent=settings.fromFirst?`원곡 ${L.clock(plan.origin)} → Motion 00:00.00 · 총 ${plan.duration.toFixed(2)}초`:`원곡 시간을 유지합니다. 첫 가사 ${L.clock(plan.cues[0].start)} · 총 ${plan.duration.toFixed(2)}초`;
    $('status').textContent=`${plan.rows.length}줄 · 미지정 ${plan.untimed||0}줄 · ${settings.fromFirst?'첫 가사 기준':'원곡 시간 기준'}`;$('status').classList.remove('error');
    if(resetTime)current=Math.min(plan.duration,plan.cues.find(c=>c.text).start+settings.transition);else current=Math.min(current,plan.duration);
    $('create').disabled=busy||dirty||!target||analyzing||($('meshMotion').checked&&(!meshSource||!audioAnalysis));$('savePlan').disabled=dirty;$('saveLrc').disabled=!target||dirty;resize();paint();
  }
  function apply(){
    try{parsed=L.parse($('lrc').value);dirty=false;target=null;nativeHeights=null;pause();rebuild(true);}
    catch(e){dirty=true;$('create').disabled=$('savePlan').disabled=true;$('status').textContent=e.message;$('status').classList.add('error');throw e;}
  }
  function updateSettings(id){
    const value=Object.fromEntries(ids.map(k=>[k,k==='color'?$(k).value:Number($(k).value)]));value.transition/=1000;value.inactive/=100;
    if(id==='fontSize'){value.lineHeight=Math.round(value.fontSize*1.22);}
    settings=L.normalize({...settings,...value,fromFirst:$('fromFirst').checked});nativeHeights=target?target.preview.heights:null;syncInputs();rebuild();
  }
  function paint(){
    if(!plan)return;current=Math.min(plan.duration,Math.max(0,current));
    $('strip').style.top=plan.baseY+'px';$('strip').style.transform=`translateY(${L.valueAt(plan.scroll,current)}px)`;
    [...$('strip').children].forEach((node,i)=>{node.style.opacity=L.valueAt(plan.rows[i].opacity,current);node.style.filter=`blur(${L.valueAt(plan.rows[i].blur,current)}px)`;});
    $('scrub').value=current;$('timeInfo').textContent=L.clock(current);$('timeInfo').title='원곡 '+L.clock(current+plan.origin);$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'미리보기 일시 정지':'미리보기 재생');
    paintMesh();
  }
  function paintMesh(){
    const enabled=$('meshMotion').checked&&meshSettings&&target;
    $('meshCanvas').classList.toggle('hidden',!enabled||!meshRenderer);if(!enabled)return;
    const snapshot=LyricsMesh.at(audioAnalysis,current+(plan?.origin||0),meshSettings.motionAmount);
    for(const [id,k] of [['meshBass','bass'],['meshVocal','vocal'],['meshDrums','hit'],['meshInst','instruments']])$(id).value=snapshot[k];
    if(!meshRenderer)return;
    const p=target.preview,bg=p.background||{width:target.width,height:target.height,x:0,y:0};
    meshRenderer.draw(meshSettings,snapshot,bg.width,bg.height);
    const c=$('meshCanvas');if(c.width!==p.width||c.height!==p.height){c.width=Math.round(p.width);c.height=Math.round(p.height);}
    const ctx=c.getContext('2d'),tokens=AlbumMesh.albumTokens(meshSettings.palette);ctx.filter='none';ctx.globalAlpha=1;ctx.fillStyle=tokens.baseHex;ctx.fillRect(0,0,c.width,c.height);
    ctx.globalAlpha=meshSettings.meshOpacity;ctx.filter=`blur(${meshSettings.blur}px)`;ctx.drawImage(meshGL,-12-bg.x,-24-bg.y);ctx.filter='none';ctx.globalAlpha=meshSettings.veilOpacity;ctx.fillRect(0,0,c.width,c.height);ctx.globalAlpha=1;
  }
  function timestamp(value){
    const s=value.trim();if(!s)return null;if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
    const m=s.match(/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/);if(!m)throw new Error('초 또는 00:16.37 형태로 입력해 주세요.');return Number(m[1])*60+Number(m[2])+(m[3]?Number(m[3])/10**m[3].length:0);
  }
  function setTime(id,value){
    const next={...manualTimes,[id]:value};L.compileDesign(parsed,settings,target.preview,next);manualTimes=next;rebuild();renderUntimed();
  }
  function renderUntimed(){
    const container=$('untimedRows');container.replaceChildren();
    if(!target){$('untimedInfo').textContent='시간이 없는 줄은 강조하지 않고 실제 위치에 남겨둡니다.';return;}
    const extra=target.preview.rows.filter(r=>!r.anchored);
    $('untimedInfo').textContent=`디자인의 추가 가사 ${extra.length}줄 · 아직 미지정 ${plan.untimed}줄. 시간은 싱크 보정 전 원곡 기준입니다.`;
    for(const r of extra){
      const row=document.createElement('div');row.className='untimed-row';const text=document.createElement('p');text.textContent=r.text;
      const controls=document.createElement('div');controls.className='row';const input=document.createElement('input');input.type='text';input.placeholder='시간 미지정';input.setAttribute('aria-label',r.text+' 시작 시간');input.value=manualTimes[r.id]==null?'':L.clock(manualTimes[r.id]);
      input.onchange=safe(()=>{try{setTime(r.id,timestamp(input.value));}catch(e){input.value=manualTimes[r.id]==null?'':L.clock(manualTimes[r.id]);throw e;}});
      const now=document.createElement('button');now.textContent='현재 시간';now.onclick=safe(()=>setTime(r.id,Math.max(0,current+plan.origin-settings.syncOffset/1000)));
      const clear=document.createElement('button');clear.textContent='지우기';clear.onclick=()=>setTime(r.id,null);controls.append(input,now,clear);row.append(text,controls);container.append(row);
    }
  }
  async function analyzeMusic(){
    if(!audioChannels||!meshSettings){audioAnalysis=null;rebuild();return;}
    const revision=++audioRevision;analyzing=true;audioAnalysis=null;rebuild();
    try{const result=await LyricsMesh.analyze(audioChannels,audioRate,meshSettings,p=>{if(revision===audioRevision)$('audioInfo').textContent=`음악 반응 분석 · ${Math.round(p*100)}%`;},()=>new Promise(r=>setTimeout(r,0)));
      if(revision===audioRevision){audioAnalysis=result;$('audioInfo').textContent=`음악 반응 준비 · ${result.duration.toFixed(2)}초 · 가사와 같은 시간으로 재생합니다.`;}
    }finally{if(revision===audioRevision){analyzing=false;rebuild();}}
  }
  function pause(){playing=false;$('audio').pause();paint();}
  function seek(t){current=t;if(audioUrl)$('audio').currentTime=Math.max(0,current+(plan?.origin||0));paint();}
  async function play(){
    if(!plan)return;if(playing){pause();return;}if(current>=plan.duration)seek(plan.cues[0].start);
    if(audioUrl){$('audio').currentTime=current+plan.origin;await $('audio').play();}else {playing=true;last=0;paint();}
  }
  function tick(now){
    const delta=last?Math.min(.1,(now-last)/1000):0;last=now;
    if(playing&&plan){current=audioUrl?$('audio').currentTime-plan.origin:current+delta;if(current>=plan.duration){current=plan.duration;pause();}paint();}requestAnimationFrame(tick);
  }
  Object.entries(bezierIds).forEach(([k,id])=>{$(id).onchange=()=>setBezier({...settings.bezier,[k]:Number($(id).value)});});
  Object.entries(bezierPresets).forEach(([id,b])=>{$(id).onclick=()=>setBezier(b);});
  let bezierDrag=null;
  $('bezierGraph').onpointerdown=e=>{const point=e.target.dataset.point;if(!point)return;bezierDrag=point;e.preventDefault();$('bezierGraph').setPointerCapture(e.pointerId);};
  $('bezierGraph').onpointermove=e=>{if(!bezierDrag)return;const r=$('bezierGraph').getBoundingClientRect(),x=((e.clientX-r.left)/r.width*180-20)/140,y=(100-(e.clientY-r.top)/r.height*120)/80;setBezier({...settings.bezier,['x'+bezierDrag]:Math.round(x*100)/100,['y'+bezierDrag]:Math.round(y*100)/100});};
  $('bezierGraph').onpointerup=$('bezierGraph').onpointercancel=$('bezierGraph').onlostpointercapture=()=>{bezierDrag=null;};
  $('inspectDesign').onclick=safe(()=>{const link=$('targetLink').value.trim();let nodeId;if(link){const url=new URL(link);if(!/(^|\.)figma\.com$/.test(url.hostname)||!url.searchParams.get('node-id'))throw new Error('node-id가 포함된 Figma 프레임 링크를 입력해 주세요.');nodeId=url.searchParams.get('node-id').replace('-',':');if(!/^\d+:\d+$/.test(nodeId))throw new Error('프레임 ID를 확인해 주세요.');}if(dirty)apply();post({type:'inspect-design',nodeId,lrc:$('lrc').value,settings});});
  $('lrc').value=LYRICS_SAMPLE;
  $('targetLink').oninput=()=>{target=null;$('create').disabled=true;$('targetInfo').textContent='가사 뷰를 다시 읽어 주세요.';rebuild();};
  $('lrc').oninput=()=>{pause();target=null;dirty=true;$('create').disabled=$('savePlan').disabled=true;$('status').textContent='가사 적용을 눌러 시간을 갱신하세요.';$('phoneWrap').classList.add('hidden');$('emptyPreview').classList.remove('hidden');$('play').disabled=$('scrub').disabled=$('first').disabled=true;};
  $('applyLrc').onclick=safe(apply);$('sample').onclick=safe(()=>{$('lrc').value=LYRICS_SAMPLE;apply();});
  $('loadLrc').onclick=()=>$('lrcFile').click();$('lrcFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>262144)throw new Error('256KB 이하의 LRC를 사용해 주세요.');$('lrc').value=await file.text();apply();});
  ids.forEach(id=>{$(id)[id==='inactive'||id==='blur'?'oninput':'onchange']=()=>updateSettings(id);});$('fromFirst').onchange=()=>{pause();updateSettings();seek(plan.cues[0].start);};
  $('play').onclick=safe(play);$('scrub').oninput=()=>seek(Number($('scrub').value));$('first').onclick=()=>seek(Math.min(plan.duration,plan.cues.find(c=>c.text).start+settings.transition));
  $('loadAudio').onclick=()=>$('audioFile').click();$('audioFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>150*1024*1024)throw new Error('150MB 이하의 오디오를 선택해 주세요.');pause();++audioRevision;audioAnalysis=null;audioChannels=null;analyzing=true;rebuild();
    if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(file);$('audio').src=audioUrl;$('audio').classList.remove('hidden');$('audioInfo').textContent=file.name+' · 음악 읽는 중…';
    const context=new(window.AudioContext||window.webkitAudioContext)();try{const buffer=await context.decodeAudioData(await file.arrayBuffer());audioChannels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));audioRate=buffer.sampleRate;}finally{await context.close();analyzing=false;rebuild();}
    if(meshSettings)await analyzeMusic();else $('audioInfo').textContent=file.name+' · Mesh를 연결하면 음악 반응을 분석합니다.';
  });
  $('audio').onplay=()=>{if(plan&&$('audio').currentTime<plan.origin)$('audio').currentTime=plan.origin;playing=true;last=0;paint();};$('audio').onpause=()=>{playing=false;paint();};$('audio').onseeked=()=>{if(plan){current=$('audio').currentTime-plan.origin;paint();}};$('audio').onended=pause;
  $('audio').onerror=()=>{pause();++audioRevision;analyzing=false;audioAnalysis=null;audioChannels=null;notify('이 오디오 형식을 재생할 수 없습니다. 다른 파일을 선택해 주세요.');URL.revokeObjectURL(audioUrl);audioUrl=null;$('audio').classList.add('hidden');rebuild();};
  $('create').onclick=()=>{if(busy||dirty||!target||analyzing||($('meshMotion').checked&&(!meshSource||!audioAnalysis)))return;pause();busy=true;$('create').disabled=true;post({type:'apply-existing',nodeId:target.id,signature:target.signature,lrc:$('lrc').value,manualTimes,settings:plan.settings,mesh:$('meshMotion').checked?{nodeId:meshSource.nodeId,signature:meshSource.signature,settings:meshSettings,analysis:audioAnalysis}:null});};
  $('restoreDesign').onclick=()=>{if(target&&!busy){pause();busy=true;$('create').disabled=$('restoreDesign').disabled=true;post({type:'restore-existing',nodeId:target.id});}};
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('savePlan').onclick=()=>download(new Blob([JSON.stringify({format:'rhime-lyrics-motion',version:'0.3.0',...plan,manualTimes,mesh:meshSettings?{settings:meshSettings,analysis:audioAnalysis}:null},null,2)],{type:'application/json'}),'rhime-lyrics-motion.json');
  $('saveLrc').onclick=()=>{const resolved=L.resolveRows(parsed,target.preview.rows,manualTimes);download(new Blob([resolved.parsed.cues.map(c=>'['+L.clock(c.start)+']'+c.text).join('\n')+'\n'],{type:'text/plain;charset=utf-8'}),'rhime-lyrics.lrc');if(plan.untimed)notify(`시간 미지정 ${plan.untimed}줄은 LRC에서 제외하고 디자인에 유지했습니다.`);};
  $('connectMesh').onclick=()=>post({type:'inspect-mesh',nodeId:$('meshSources').value||undefined});
  $('loadMeshSettings').onclick=()=>$('meshSettingsFile').click();$('meshSettingsFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>1024*1024)throw new Error('1MB 이하의 Mesh 설정 JSON을 선택해 주세요.');meshSettings=LyricsMesh.config(JSON.parse(await file.text()));meshSettingsImported=true;$('meshInfo').textContent='Mesh 설정을 불러왔습니다. Figma 출력에는 Shader 연결이 필요합니다.';$('meshMotion').checked=true;rebuild();await analyzeMusic();});
  $('meshMotion').onchange=()=>{pause();rebuild();};
  window.onmessage=e=>{
    const m=e.data.pluginMessage;if(!m)return;
    if(m.type==='design-info'){
      target=m;const p=m.preview;nativeHeights=p.heights;manualTimes=Object.fromEntries(Object.entries(manualTimes).filter(([id])=>p.rows.some(r=>r.id===id&&!r.anchored)));
      settings=L.normalize({...settings,width:p.width,height:p.height,margin:p.margin,fontSize:p.fontSize,lineHeight:p.heights[0],color:p.color});
      $('designInfo').value=JSON.stringify(m.data);$('targetInfo').textContent=m.name+' · '+m.width+' × '+m.height+' · 가사 '+m.lines+'줄 연결됨';
      $('restoreDesign').disabled=!m.restored;syncInputs();rebuild(true);renderUntimed();
    }
    else if(m.type==='selection'){}
    else if(m.type==='mesh-options'){
      $('meshSources').replaceChildren();const first=document.createElement('option');first.value='';first.textContent='현재 선택한 Shader 레이어';$('meshSources').append(first);
      for(const item of m.items){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;$('meshSources').append(option);}
    }
    else if(m.type==='mesh-info'){meshSource=m.mesh;if(!meshSettingsImported)meshSettings=m.mesh.settings;$('meshInfo').textContent=`${m.mesh.name} · ${m.mesh.slots.length}색상 연결. 가사 화면 밖의 Shader를 선택한 경우 기존 가사 화면의 배경 Fill에 적용합니다.`;$('meshMotion').checked=true;rebuild();safe(analyzeMusic)();}
    else if(m.type==='applied'){busy=false;if(target)target.restored=true;$('restoreDesign').disabled=false;rebuild();notify(`${m.name} · 가사 ${m.lines}줄 / 미지정 ${m.untimed}줄 · 배경 ${m.meshTracks}색상 트랙 · ${m.keyframes}개 키프레임 적용.`);}
    else if(m.type==='restored'){busy=false;target=null;$('restoreDesign').disabled=true;$('create').disabled=true;$('targetInfo').textContent='적용 전 스타일과 모션을 복원했습니다. 다시 읽어서 적용할 수 있습니다.';rebuild();notify('원본 가사 스타일과 모션을 복원했습니다.');}
    else if(m.type==='error'){busy=false;$('restoreDesign').disabled=!target;$('create').disabled=dirty||!target;notify(m.message);}
  };
  new ResizeObserver(resize).observe($('stage'));syncInputs();apply();document.fonts.ready.then(()=>{nativeHeights=target?target.preview.heights:null;rebuild();});requestAnimationFrame(tick);post({type:'init'});
  // Playback is explicit; there is no automatic motion on opening the panel.
})();
