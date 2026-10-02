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
