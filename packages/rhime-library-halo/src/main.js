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
