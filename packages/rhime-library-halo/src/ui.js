(function () {
  'use strict';
  const H=LibraryHalo,C=LibraryColor,$=id=>document.getElementById(id);
  let albums=[],palette=[],settings=H.normalize(),phase=0,lastTime=0,lastPaint=0,painted=null,busy=false,importBusy=false;
  let decoding=Promise.resolve(),pendingImports=0,importEnded=false,toastTimer;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(reduced.matches)$('motion').checked=false;
  const post=m=>parent.postMessage({pluginMessage:m},'*');
  function notify(text) {$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);}
  function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notify(e.message||String(e));}};}
  function buttons() {
    const available=palette.length>0&&!busy&&!importBusy;
    $('create').disabled=$('download').disabled=$('createOutline').disabled=!available;
    $('savePalette').disabled=!palette.length;
    $('upload').disabled=$('importSelection').disabled=$('demo').disabled=importBusy;
    $('clear').disabled=importBusy||!albums.length;
    $('loadPalette').disabled=importBusy;
  }
  function rebuildPalette() {palette=H.aggregate(albums);showPalette();paint();buttons();}
  function showPalette() {
    const container=$('palette');container.replaceChildren();
    if(!palette.length){const p=document.createElement('div');p.className='empty-palette';p.style.gridColumn='1/-1';p.textContent='커버를 먼저 불러와 주세요.';container.appendChild(p);}
    palette.forEach((g,i)=>{
      const label=document.createElement('label'),input=document.createElement('input'),hex=document.createElement('span');
      input.type='color';input.value=C.hex(g.color);input.setAttribute('aria-label','라이브러리 색상 '+(i+1));hex.textContent=input.value.slice(1);
      input.oninput=()=>{g.color=C.parseHex(input.value);hex.textContent=C.hex(g.color).slice(1);paint();};
      label.title=g.weight+'개 앨범의 색';label.append(input,hex);container.appendChild(label);
    });
    const included=albums.filter(a=>a.included!==false).length;
    $('libraryInfo').textContent=albums.length?`${albums.length}개 커버 · ${included}개 포함 · 동일한 커버는 한 번만 반영`:'최대 100개 · 앨범마다 대표색 하나 · 로컬에서 처리';
    $('paletteInfo').textContent=palette.length?`${included}개 앨범 → ${palette.length}색 · 비슷한 색만 묶고 앨범마다 같은 비중으로 반영`:'비슷한 색을 묶고, 서로 다른 색은 최대 8개까지 유지합니다.';
    $('previewNote').textContent=palette.length?`${included}개 앨범의 색 · 56px / 투명 PNG 3×\nPNG는 색만 저장 · 피그마 생성은 같은 순간의 아웃라인도 포함`:'커버를 불러오면 라이브러리의 색이 여기에 번집니다.';
    $('previewNote').style.whiteSpace='pre-line';
  }
  function showCovers() {
    $('covers').replaceChildren();$('previewCovers').replaceChildren();
    albums.forEach(a=>{
      const tile=document.createElement('div');tile.className='cover'+(a.included===false?' excluded':'');
      const image=document.createElement('img');image.alt=a.name;if(a.url)image.src=a.url;
      else image.style.background=C.hex(a.color);
      const include=document.createElement('input');include.type='checkbox';include.checked=a.included!==false;include.setAttribute('aria-label',a.name+' 포함');
      include.onchange=()=>{a.included=include.checked;showCovers();rebuildPalette();};
      const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',a.name+' 제거');
      remove.onclick=()=>{if(a.url)URL.revokeObjectURL(a.url);albums=albums.filter(v=>v!==a);showCovers();rebuildPalette();};
      const dot=document.createElement('i');dot.className='dot';dot.style.background=C.hex(a.color);
      const name=document.createElement('span');name.textContent=a.name;tile.title=a.name+' · '+C.hex(a.color);tile.append(image,include,remove,dot,name);$('covers').appendChild(tile);
    });
    const included=albums.filter(a=>a.included!==false);
    included.slice(0,8).forEach(a=>{const image=document.createElement('img');image.alt=a.name;image.title=a.name;if(a.url)image.src=a.url;else image.style.background=C.hex(a.color);$('previewCovers').appendChild(image);});
    if(included.length>8){const more=document.createElement('span');more.className='more';more.textContent='+'+(included.length-8);$('previewCovers').appendChild(more);}
  }
  function clear() {albums.forEach(a=>{if(a.url)URL.revokeObjectURL(a.url);});albums=[];showCovers();rebuildPalette();}
  async function addBlob(blob,name) {
    if(albums.length>=H.MAX_ALBUMS)throw new Error('최대 100개 커버까지 사용할 수 있습니다.');
    if(!blob.size||blob.size>24*1024*1024)throw new Error(name+': 24MB 이하의 이미지를 선택해 주세요.');
    const url=URL.createObjectURL(blob),image=new Image();
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error(name+': 이미지를 읽을 수 없습니다.'));image.src=url;});
      const sample=document.createElement('canvas');sample.width=sample.height=96;
      const x=sample.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,96,96);
      const data=x.getImageData(0,0,96,96).data,id=H.fingerprint(data);
      if(albums.some(a=>a.id===id)){URL.revokeObjectURL(url);return false;}
      const color=H.representative(C.extractPalette(data,5));
      // Retain only a small thumbnail after extraction, not every full artwork.
      const thumbnail=await new Promise(resolve=>sample.toBlob(resolve,'image/png'));
      URL.revokeObjectURL(url);
      albums.push({id,name,color,url:URL.createObjectURL(thumbnail),included:true});return true;
    } catch(e){URL.revokeObjectURL(url);throw e;}
  }
  async function addFiles(files) {
    if(importBusy)return;
    importBusy=true;buttons();let added=0,duplicates=0,errors=[];
    try {
      for(const file of files) {
        try {if(await addBlob(file,file.name))added++;else duplicates++;}
        catch(e){errors.push(e.message);if(albums.length>=H.MAX_ALBUMS)break;}
      }
      showCovers();rebuildPalette();
      notify(`${added}개 커버를 불러왔습니다.`+(duplicates?` 중복 ${duplicates}개 제외.`:'')+(errors.length?` ${errors.length}개 실패: ${errors[0]}`:''));
    } finally {importBusy=false;buttons();}
  }
  function updateSettings() {
    settings=H.normalize({...settings,...Object.fromEntries(['width','strength','softness'].map(id=>[id,Number($(id).value)]))});
    ['width','height','strength','softness'].forEach(id=>{$(id).value=settings[id];});
    for(const id of ['strength','softness'])$(id).nextElementSibling.textContent=settings[id]+'%';
    layout();paint();
  }
  function showOutline(paint) {
    const gradient=$('haloOutlineGradient'),svg=$('outlinePreview');
    svg.style.display=paint?'block':'none';
    if(!paint){gradient.replaceChildren();$('outlineSwatch').style.background='';return;}
    while(gradient.children.length<paint.gradientStops.length)gradient.appendChild(document.createElementNS('http://www.w3.org/2000/svg','stop'));
    const css=[];
    paint.gradientStops.forEach((stop,i)=>{
      const c=stop.color,rgb=[c.r,c.g,c.b].map(v=>Math.round(v*255)),node=gradient.children[i];
      node.setAttribute('offset',stop.position);node.setAttribute('stop-color',`rgb(${rgb.join(',')})`);node.setAttribute('stop-opacity',c.a);
      css.push(`rgba(${rgb.join(',')},${c.a}) ${stop.position*100}%`);
    });
    $('outlineSwatch').style.background=`linear-gradient(90deg,${css.join(',')})`;
  }
  function layout() {
    const dark=settings.theme==='dark';$('stage').classList.toggle('dark',dark);$('magnified').classList.toggle('dark',dark);
    const available=Math.max(100,$('stage').clientWidth-40),scale=Math.min(1,available/settings.width,150/settings.height);
    $('field').style.width=settings.width+'px';$('field').style.height=settings.height+'px';
    $('field').style.transform=`scale(${scale})`;$('field').style.margin=`${-settings.height*(1-scale)/2}px ${-settings.width*(1-scale)/2}px`;
    const detailScale=Math.min(1.5,Math.max(100,$('magnified').clientWidth-36)/settings.width,110/settings.height);
    $('detailField').style.width=settings.width+'px';$('detailField').style.height=settings.height+'px';$('detailField').style.transform=`scale(${detailScale})`;
    $('detailField').style.margin=`${settings.height*(detailScale-1)/2}px ${settings.width*(detailScale-1)/2}px`;
    $('outlinePreview').setAttribute('viewBox',`0 0 ${settings.width} ${settings.height}`);
    $('outlineRect').setAttribute('width',settings.width-1);$('outlineRect').setAttribute('height',settings.height-1);$('outlineRect').setAttribute('rx',27.5);
    $('sizeNote').textContent=settings.width+' × '+settings.height;
    $('motionStatus').textContent=$('motion').checked?'천천히 흐르는 중':'멈춘 색';
  }
  function paint() {
    if(!palette.length) {
      const x=$('haloCanvas').getContext('2d');x.clearRect(0,0,$('haloCanvas').width,$('haloCanvas').height);
      const d=$('detailCanvas').getContext('2d');d.clearRect(0,0,$('detailCanvas').width,$('detailCanvas').height);painted=null;showOutline(null);return;
    }
    const frame=H.snapshot(settings,palette,phase),r=H.render(frame);
    for(const id of ['haloCanvas','detailCanvas']) {
      const canvas=$(id);if(canvas.width!==r.width||canvas.height!==r.height){canvas.width=r.width;canvas.height=r.height;}
      canvas.getContext('2d').putImageData(new ImageData(r.data,r.width,r.height),0,0);
    }
    const outline=H.outline(frame,r);showOutline(outline);
    painted={frame,outline,albums:albums.filter(a=>a.included!==false).map(a=>({name:a.name,color:{...a.color}}))};
  }
  function animate(time) {
    const dt=lastTime?Math.min(.1,(time-lastTime)/1000):0;lastTime=time;
    if($('motion').checked&&palette.length){phase+=dt;if(time-lastPaint>=66){paint();lastPaint=time;}}
    requestAnimationFrame(animate);
  }
  async function capture() {
    if(!painted)throw new Error('앨범 커버를 먼저 불러와 주세요.');
    // Copy both pixels and metadata synchronously, before PNG encoding.
    const canvas=document.createElement('canvas'),source=$('haloCanvas');canvas.width=source.width;canvas.height=source.height;
    canvas.getContext('2d').drawImage(source,0,0);
    const meta=JSON.parse(JSON.stringify(painted));
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('PNG를 저장하지 못했습니다.')),'image/png'));
    return {blob,meta};
  }
  function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportPng(create) {
    if(busy)return;busy=true;buttons();
    try {
      const {blob,meta}=await capture(),s=meta.frame.settings;
      if(create)post({type:'create',settings:s,palette:meta.frame.palette,phase:meta.frame.phase,albums:meta.albums,bytes:new Uint8Array(await blob.arrayBuffer())});
      else {download(blob,`rhime-library-halo-${s.width}x${s.height}@3x.png`);busy=false;buttons();}
    } catch(e){busy=false;buttons();throw e;}
  }
  function exportOutline() {
    if(busy)return;
    if(!painted)throw new Error('앨범 커버를 먼저 불러와 주세요.');
    const meta=JSON.parse(JSON.stringify(painted));busy=true;buttons();
    post({type:'create-outline',settings:meta.frame.settings,palette:meta.frame.palette,phase:meta.frame.phase,albums:meta.albums});
  }
  async function demo() {
    // Synthetic artwork samples; no bundled user albums or external assets.
    const demos=[['Warm Notes','#C26846','#EDD6B0'],['Blue Hour','#4376BD','#D2E8ED'],['Rose Tapes','#B65E93','#E5BDCC'],['After Violet','#825FC0','#DACCF0'],['Moss Radio','#728E63','#D8DCB6']];
    const files=[];
    for(const [name,color,light] of demos) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const x=canvas.getContext('2d');
      x.fillStyle=color;x.fillRect(0,0,128,128);x.fillStyle=light;x.beginPath();x.arc(75,54,32,0,Math.PI*2);x.fill();x.fillStyle='#181818';x.fillRect(16,104,75,3);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve));files.push(new File([blob],name+'.png',{type:'image/png'}));
    }
    await addFiles(files);
  }
  $('upload').onclick=()=>$('imageFiles').click();$('imageFiles').onchange=safe(async e=>{await addFiles([...e.target.files]);e.target.value='';});
  $('demo').onclick=safe(demo);$('clear').onclick=clear;$('resetPalette').onclick=rebuildPalette;
  $('importSelection').onclick=()=>{if(importBusy)return;importBusy=true;importEnded=false;pendingImports=0;buttons();post({type:'import-selection'});};
  $('selectionSize').onclick=()=>post({type:'selection-size'});
  const drop=$('dropzone');drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=safe(async e=>{e.preventDefault();drop.classList.remove('drag');await addFiles([...e.dataTransfer.files]);});
  for(const id of ['width'])$(id).onchange=updateSettings;
  for(const id of ['strength','softness'])$(id).oninput=updateSettings;
  for(const key of ['theme'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.onclick=()=>{settings[key]=b.dataset[key];document.querySelectorAll(`[data-${key}]`).forEach(v=>v.classList.toggle('active',v===b));layout();paint();});
  $('shuffle').onclick=()=>{settings.seed++;paint();};
  $('motion').onchange=()=>{if(reduced.matches)$('motion').checked=false;layout();};
  reduced.addEventListener('change',()=>{if(reduced.matches){$('motion').checked=false;layout();}});
  $('create').onclick=safe(()=>exportPng(true));$('download').onclick=safe(()=>exportPng(false));$('createOutline').onclick=safe(exportOutline);
  $('savePalette').onclick=()=>download(new Blob([JSON.stringify({format:'rhime-library-halo',version:1,settings,palette,outline:painted.outline,phase:painted.frame.phase,albums:albums.map(({id,name,color,included})=>({id,name,color,included}))},null,2)],{type:'application/json'}),'rhime-library-palette.json');
  $('loadPalette').onclick=()=>$('paletteFile').click();$('paletteFile').onchange=safe(async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>1024*1024)throw new Error('1MB 이하의 팔레트 JSON이 필요합니다.');
    const data=JSON.parse(await file.text());
    const validColor=c=>c&&['r','g','b'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k])&&c[k]>=0&&c[k]<=1);
    if(data.format!=='rhime-library-halo'||data.version!==1||!Array.isArray(data.albums)||!data.albums.length||data.albums.length>100||!data.albums.every(a=>typeof a.id==='string'&&typeof a.name==='string'&&validColor(a.color))||!Array.isArray(data.palette)||!data.palette.length||data.palette.length>8||!data.palette.every(g=>validColor(g.color)))throw new Error('Rhime Library Halo 팔레트 파일을 선택해 주세요.');
    clear();albums=data.albums.map(a=>({id:a.id.slice(0,100),name:a.name.slice(0,200),color:C.rgb(a.color),included:a.included!==false}));
    settings=H.normalize(data.settings);palette=H.snapshot(settings,data.palette).palette;phase=0;
    ['width','height','strength','softness'].forEach(id=>{$(id).value=settings[id];});
    for(const key of ['theme'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.classList.toggle('active',b.dataset[key]===settings[key]));
    showCovers();showPalette();updateSettings();buttons();notify('라이브러리 색상을 불러왔습니다. 커버 사진은 JSON에 포함되지 않습니다.');
  });
  function finishImport() {
    if(!importEnded||pendingImports)return;
    importBusy=false;showCovers();rebuildPalette();buttons();notify(albums.length+'개 커버의 라이브러리 팔레트가 준비됐습니다.');
  }
  window.onmessage=e=>{
    const m=e.data.pluginMessage;if(!m)return;
    if(m.type==='cover') {
      pendingImports++;
      decoding=decoding.then(()=>addBlob(new Blob([m.bytes]),m.name)).catch(e=>notify(e.message)).finally(()=>{pendingImports--;finishImport();});
    } else if(m.type==='import-complete'){importEnded=true;finishImport();}
    else if(m.type==='import-warning')notify(m.name+': '+m.message);
    else if(m.type==='selection')$('importSelection').title=m.count+'개 레이어 선택됨';
    else if(m.type==='selection-size') {
      if(!m.size)notify('검색바 레이어 하나를 선택해 주세요.');
      else {settings={...settings,width:m.size.width};['width'].forEach(id=>{$(id).value=settings[id];});updateSettings();}
    } else if(m.type==='created'){busy=false;buttons();notify(m.outlineOnly?'편집 가능한 1px 아웃라인을 만들었습니다.':'색 레이어와 같은 순간의 아웃라인을 만들었습니다. 프레임에서 라운딩을 조절하세요.');}
    else if(m.type==='error'){busy=false;if(m.action==='import-selection')importBusy=false;buttons();notify(m.message);}
  };
  new ResizeObserver(layout).observe($('stage'));
  buttons();showPalette();layout();requestAnimationFrame(animate);post({type:'init'});
})();
