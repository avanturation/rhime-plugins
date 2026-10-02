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
