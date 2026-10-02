(function () {
  'use strict';
  const M=AlbumMesh,A=AlbumMeshAudio, $=id=>document.getElementById(id), standalone=parent===window;
  const state={...M.normalizeSettings(),palette:['#BA715E','#D0A272','#546D7D','#686184','#36394D'].map(M.parseHex)};
  let coverBytes=null, coverImage=null, originalPalette=[], coverURL='', sourceName='', sourceRevision=0;
  let revision=0,nativeURL='',working=false,toastTimer,selectionName='';
  let shaderInfo=null,shaderList=[],frameTime=0,lastFrame=0,flowTime=0,visualBass=0,visualHit=0,visualVocal=0,visualInst=0,colorPhases=[0,0,0,0];
  let audioContext=null, analyser=null, audioSource=null, audioURL='', spectrum=null, waveform=null;
  let geometry={points:[]},pointNodes=[],lastHUD=0,metrics={bass:0,hit:0,vocal:0,instruments:0,events:0,rms:0};
  let renderedSnapshot=null,nativeSnapshot=null;
  const captureSnapshot=()=>M.normalizeSnapshot($('phone').classList.contains('native')?nativeSnapshot:renderedSnapshot);
  const reactor=A.createReactor();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const canvas=$('meshCanvas');
  const composite=$('compositeCanvas');
  let compositeUnder=null;
  let gl=null, program=null, uniform={}, fallbackCanvas=null;
  function notify(message,isError=false) {
    $('toast').textContent=message;$('toast').className='toast show'+(isError?' error':'');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').className='toast';},isError?6500:3800);
  }
  function post(type,body={}) { if(!standalone)parent.postMessage({pluginMessage:{type,...body}},'*'); }
  function setWorking(value) {
    working=value;
    $('create').disabled=value||!coverBytes;
    $('nativePreview').disabled=value||standalone||!coverBytes||!state.shaderId;
    $('createNative').disabled=value||standalone||!coverBytes||!state.shaderId;
    $('selection').disabled=value||standalone;
    $('create').textContent=value?'처리 중…':standalone?'PNG 배경 저장 ↗':'프리뷰 그대로 만들기 ↗';
  }
  const shaders={
    vertex:'attribute vec2 aPosition; varying vec2 vUV; void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}',
    fragment:`precision highp float;
varying vec2 vUV; uniform vec3 uLab[10]; uniform vec2 uAnchors[10]; uniform vec3 uShape[10]; uniform vec4 uWarp; uniform vec4 uFlow; uniform vec4 uPhase; uniform float uContrast; uniform vec2 uSize;
float solve(float v,float k){float p=v;for(int i=0;i<7;i++){p-=(p+k*sin(3.14159265*p)-v)/(1.+k*3.14159265*cos(3.14159265*p));}return p;}
vec2 unwarp(vec2 p,vec4 w){if(p.x<=0.||p.x>=1.||p.y<=0.||p.y>=1.)return p;float y=solve(p.y,w.y*sin(3.14159265*p.x)*sin(6.2831853*p.x+w.w));return vec2(solve(p.x,w.x*sin(3.14159265*y)*sin(6.2831853*y+w.z)),y);}
vec2 pigment(vec2 p){float b=uFlow.x,v=uFlow.y,d=uFlow.z,n=uFlow.w;vec2 c=p-vec2(.52,.48);float spread=d*.48*exp(-dot(c,c)*1.5);return p-vec2(.32*b*sin(uPhase.x+p.y*1.7)+.14*v*sin(uPhase.y+p.y*1.2+p.x*.8)+.24*n*sin(uPhase.w+p.y*.9)+c.x*spread,.12*b*cos(uPhase.x+p.x*1.1)+.32*v*sin(uPhase.y+p.x*1.3)+.21*n*cos(uPhase.w+p.x*1.8)+c.y*spread+.07*d*sin(uPhase.z+p.x*2.1));}
vec3 srgb(vec3 x){return clamp(mix(12.92*x,1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),x)),0.,1.);}
vec3 color(vec3 v){float l=v.x+.3963377774*v.y+.2158037573*v.z;float m=v.x-.1055613458*v.y-.0638541728*v.z;float s=v.x-.0894841775*v.y-1.291485548*v.z;l=l*l*l;m=m*m*m;s=s*s*s;return srgb(vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s));}
float wrapped(float d,float inverseRadiusSquared,float period){d-=floor(d/period+.5)*period;float w=0.;for(int k=-2;k<=2;k++){float t=d+float(k)*period;w+=exp(-t*t*inverseRadiusSquared);}return w;}
void main(){vec2 p=(vec2(vUV.x,1.-vUV.y)*(uSize+vec2(24.,48.))-vec2(12.,24.))/uSize;p=pigment(unwarp(p,uWarp));vec3 c=vec3(0.);float total=0.;for(int i=0;i<10;i++){vec2 d=p-uAnchors[i];float w=pow(uShape[i].z*wrapped(d.x,uShape[i].x,1.65)*wrapped(d.y,uShape[i].y,1.64)+.00001,uContrast);c+=uLab[i]*w;total+=w;}gl_FragColor=vec4(color(c/total),1.);}`
  };
  function initGL() {
    gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true,antialias:false});
    if(!gl)return;
    function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,shaders.vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,shaders.fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('WebGL 미리보기 초기화 실패');
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const attr=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    ['uLab[0]','uAnchors[0]','uShape[0]','uSize','uWarp','uFlow','uPhase','uContrast'].forEach(n=>uniform[n]=gl.getUniformLocation(program,n));
  }
  function renderMesh(time=0,bass=0,hit=0,moving=false,vocal=0,instruments=0,phases=null) {
    const width=state.width,height=state.height;
    if(canvas.width!==width+24||canvas.height!==height+48){canvas.width=width+24;canvas.height=height+48;}
    if(composite.width!==width||composite.height!==height){composite.width=width;composite.height=height;}
    const warp=M.layoutWarp(state),phase=phases||M.colorPhases(time),amount=moving?state.motionAmount/100:0;
    const snapshot=moving&&state.motionAmount>0?{model:'color-flow-v2',time,bass,hit,vocal,instruments,phases:phase.slice(),strength:state.motionAmount,...(audioURL?{audioTimeSeconds:$('audio').currentTime}:{})}:null;
    if(gl&&!gl.isContextLost()) {
      gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);
      const sites=M.anchors(state.seed),labs=M.ambientPalette(state.palette).map(M.toLab);
      gl.uniform3fv(uniform['uLab[0]'],new Float32Array(sites.flatMap(p=>labs[p.colorIndex])));
      gl.uniform2fv(uniform['uAnchors[0]'],new Float32Array(sites.flatMap(p=>[p.x,p.y])));
      gl.uniform3fv(uniform['uShape[0]'],new Float32Array(sites.flatMap(p=>[1/(p.rx*p.rx),1/(p.ry*p.ry),p.weight])));
      gl.uniform2fv(uniform.uSize,[width,height]);gl.uniform1f(uniform.uContrast,M.FIELD_CONTRAST);gl.uniform4fv(uniform.uWarp,warp);gl.uniform4fv(uniform.uFlow,[bass,vocal,hit,instruments].map(v=>v*amount));gl.uniform4fv(uniform.uPhase,phase);
      gl.drawArrays(gl.TRIANGLES,0,6);renderComposite();renderedSnapshot=snapshot;return;
    }
    // Software fallback remains functional when GPU contexts are unavailable.
    if(!fallbackCanvas){fallbackCanvas=document.createElement('canvas');fallbackCanvas.className=canvas.className;canvas.replaceWith(fallbackCanvas);}
    const fw=Math.ceil(canvas.width/4),fh=Math.ceil(canvas.height/4);
    if(fallbackCanvas.width!==fw||fallbackCanvas.height!==fh){fallbackCanvas.width=fw;fallbackCanvas.height=fh;}
    const ctx=fallbackCanvas.getContext('2d'), image=ctx.createImageData(fw,fh), sample=M.field(M.ambientPalette(state.palette),state.seed,warp,snapshot,M.FIELD_CONTRAST);
    for(let y=0;y<fh;y++)for(let x=0;x<fw;x++) {
      const c=sample(((x+.5)/fw*canvas.width-12)/width,((y+.5)/fh*canvas.height-24)/height),n=(y*fw+x)*4;
      image.data[n]=Math.round(c.r*255);image.data[n+1]=Math.round(c.g*255);image.data[n+2]=Math.round(c.b*255);image.data[n+3]=255;
    }
    ctx.putImageData(image,0,0);
    renderComposite();renderedSnapshot=snapshot;
  }
  function computeGeometry(snapshot=null){
    let defs=shaderInfo&&shaderInfo.definitions,defaults=shaderInfo&&shaderInfo.defaults||{};
    if(!defs){defs={};for(let i=0;i<16;i++)defs['point-'+i]={type:'COLOR_POINT',name:'Point '+i,defaultValue:{x:(i%4)/3,y:Math.floor(i/4)/3}};}
    try{return M.shaderAssignments(defs,state.palette,state.seed,defaults,{...state,coordinateUnits:shaderInfo&&shaderInfo.coordinateUnits},snapshot).geometry;}catch(e){return {points:[],movedPoints:0,maxMovePx:0};}
  }
  function refreshGeometry(snapshot=null){
    geometry=computeGeometry(snapshot);
    const root=$('pointOverlay');root.replaceChildren();pointNodes=[];
    const svg=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);root.appendChild(el);return el;};
    for(const p of geometry.points){
      svg('circle',{cx:p.before.x*state.width,cy:p.before.y*state.height,r:5,class:'origin'});
      const line=svg('line',{x1:p.before.x*state.width,y1:p.before.y*state.height,x2:p.after.x*state.width,y2:p.after.y*state.height});
      const dot=svg('circle',{cx:p.after.x*state.width,cy:p.after.y*state.height,r:5});pointNodes.push({p,line,dot});
    }
    $('pointHint').textContent=geometry.points.length?(shaderInfo?'Shader':'참고 격자')+' 기본 배치 '+geometry.movedPoints+'개 변형 · 최대 '+geometry.maxMovePx.toFixed(1)+'px · '+(snapshot?'현재 색 저장 · 위치 고정':'기본 배치 · 음악 재생 중 위치 고정'):'이 Shader에는 이동 가능한 포인트 속성이 없습니다.';
  }
  function colorPoints(time,bass,hit,moving,vocal=0,instruments=0,phases=null){
    if(!$('phone').classList.contains('show-points'))return 0;
    const snapshot=moving?{model:'color-flow-v2',time,bass,hit,vocal,instruments,phases:phases||M.colorPhases(time),strength:state.motionAmount}:null;
    const sample=M.field(M.ambientPalette(state.palette),state.seed,null,snapshot,M.FIELD_CONTRAST);
    // Keep markers in place; their fill shows the colour passing through them.
    for(const {p,dot}of pointNodes)dot.style.fill=M.hex(sample(p.before.x,p.before.y));
    return 0;
  }
  function drawPalette() {
    $('palette').replaceChildren();
    state.palette.forEach((c,i)=>{
      const wrap=document.createElement('label');wrap.className='swatch';
      const input=document.createElement('input');input.type='color';input.value=M.hex(c);input.setAttribute('aria-label','팔레트 색상 '+(i+1));
      const value=document.createElement('span');value.textContent=M.hex(c).slice(1);
      input.addEventListener('input',()=>{state.palette[i]=M.parseHex(input.value);value.textContent=M.hex(state.palette[i]).slice(1);changed();});
      wrap.append(input,value);$('palette').appendChild(wrap);
    });
  }
  function setView(mode) {
    state.viewMode=mode==='lyrics'?'lyrics':'normal';
    $('phone').classList.toggle('lyrics-view',state.viewMode==='lyrics');
    $('previewLabel').textContent=state.viewMode==='lyrics'?'가사 미리보기':'앨범 미리보기';
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.viewMode));
    // Layout-only: preserve audio, native previews and the exact painted frame.
  }
  function setViewport(value) {
    const snapshot=captureSnapshot();
    Object.assign(state,value==='duo'?{width:953,height:671}:{width:M.W,height:M.H});
    changed(snapshot);
  }
  function fitPreview() {
    const area=document.querySelector('.preview-area'),wrap=document.querySelector('.phone-wrap');
    const scale=Math.max(.1,Math.min(.68,(area.clientHeight-204)/state.height,(area.clientWidth-56)/state.width));
    wrap.style.width=(state.width*scale)+'px';wrap.style.height=(state.height*scale)+'px';$('phone').style.transform='scale('+scale+')';
  }
  function changed(snapshot=null) {
    revision++;$('phone').classList.remove('native');setView(state.viewMode);
    $('phone').style.width=state.width+'px';$('phone').style.height=state.height+'px';
    $('phone').classList.toggle('duo',state.width===953);
    $('viewportSize').value=state.width===953?'duo':'iphone';
    $('sizeLabel').textContent=state.width+' × '+state.height;
    $('pointOverlay').setAttribute('viewBox','0 0 '+state.width+' '+state.height);
    fitPreview();
    const tokens=M.albumTokens(state.palette),base=tokens.baseHex;
    $('phone').style.color=tokens.textHex;
    $('textColor').value=tokens.textHex;$('textOklch').textContent=tokens.textOklch;
    $('textSwatch').style.background=tokens.textHex;$('phone').style.background=base;$('base').style.background=base;
    for(const key of ['coverOpacity','meshOpacity','veilOpacity','blur','bpm','motionAmount','pointVariation','sensitivity']) {
      const percent=key.endsWith('Opacity')||key==='pointVariation',v=percent?Math.round(state[key]*100):state[key];
      $(key).value=v;$(key).nextElementSibling.textContent=v+(percent||key==='motionAmount'?'%':key==='blur'?'px':key==='sensitivity'?'×':'');
    }
    for(const key of ['bass','vocal','drums','instruments']){$(key+'Mix').value=state.channelMix[key]*100;$(key+'Mix').nextElementSibling.textContent=Math.round(state.channelMix[key]*100)+'%';}
    document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));
    const weights=M.compositeWeights(state);
    $('composition').replaceChildren();
    const b=document.createElement('b');b.textContent=base+' · '+(state.meshBlendMode==='NORMAL'?'Mesh 기여도 '+Math.round(weights.mesh*100)+'%':state.meshBlendMode.toLowerCase().replace('_',' ')+' 합성');
    $('composition').append(b,document.createElement('br'),document.createTextNode('Base → Cover → Mesh → 단색 + Blur'));
    $('previewNote').textContent=state.width+' × '+state.height+' · 보이는 배경 그대로 PNG 저장 · 콘텐츠 제외';
    refreshGeometry(snapshot);renderMesh(snapshot?snapshot.time:0,snapshot?snapshot.bass:0,snapshot?snapshot.hit:0,!!snapshot,snapshot?snapshot.vocal:0,snapshot?snapshot.instruments:0,snapshot?snapshot.phases:null);setWorking(working);
  }
  async function imageFromBytes(data) {
    const url=URL.createObjectURL(new Blob([data]));
    try{const image=new Image();image.src=url;await image.decode();return image;}
    finally{URL.revokeObjectURL(url);}
  }
  const blobBytes=async(canvas)=>new Uint8Array(await (await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지 변환 실패')),'image/png'))).arrayBuffer());
  async function loadCover(data,name) {
    const ticket=++sourceRevision;
    if(data.byteLength>24*1024*1024)throw new Error('24MB 이하의 이미지를 사용해 주세요.');
    const img=await imageFromBytes(data);
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('이미지 크기를 읽을 수 없습니다.');
    if(img.naturalWidth*img.naturalHeight>50_000_000)throw new Error('5000만 픽셀 이하의 커버를 사용해 주세요.');
    const sample=document.createElement('canvas');sample.width=96;sample.height=96;
    const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,96,96);
    const pixels=ctx.getImageData(0,0,96,96).data,palette=M.extractPalette(pixels),coverSeed=M.coverSeed(pixels);
    const scaled=document.createElement('canvas'),factor=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));
    scaled.width=Math.max(1,Math.round(img.naturalWidth*factor));scaled.height=Math.max(1,Math.round(img.naturalHeight*factor));
    scaled.getContext('2d').drawImage(img,0,0,scaled.width,scaled.height);
    const normalized=await blobBytes(scaled);
    if(ticket!==sourceRevision)return;
    if(coverURL)URL.revokeObjectURL(coverURL);
    coverURL=URL.createObjectURL(new Blob([normalized],{type:'image/png'}));coverBytes=normalized;coverImage=img;sourceName=name;
    originalPalette=palette.map(c=>({...c}));state.palette=palette;state.coverSeed=coverSeed;state.seed=0;
    for(const id of ['coverThumb','backCover','miniCover','albumCover'])$(id).src=coverURL;
    $('coverName').textContent=name;$('coverInfo').textContent=img.naturalWidth+' × '+img.naturalHeight+' · 5색 추출 완료';
    $('trackName').textContent=name==='Evening, in color · 예시'?'Evening, in color':name.replace(/\.[^.]+$/,'').slice(0,32);
    $('albumTrack').textContent=$('trackName').textContent;drawPalette();changed();
  }
  async function sampleCover() {
    // Original procedural demo artwork, not a real album or an external asset.
    const c=document.createElement('canvas');c.width=c.height=640;const x=c.getContext('2d');
    const sky=x.createLinearGradient(0,0,0,640);sky.addColorStop(0,'#57657d');sky.addColorStop(.44,'#ba806e');sky.addColorStop(.73,'#d6a375');sky.addColorStop(1,'#333f56');x.fillStyle=sky;x.fillRect(0,0,640,640);
    x.fillStyle='#d8b49b';x.beginPath();x.arc(342,238,72,0,Math.PI*2);x.fill();
    const hill=(color,y,amp,phase)=>{x.fillStyle=color;x.beginPath();x.moveTo(0,640);for(let i=0;i<=640;i+=4)x.lineTo(i,y+Math.sin(i/130+phase)*amp);x.lineTo(640,640);x.fill();};
    hill('#846977',348,24,1);hill('#586276',403,31,2);hill('#364457',472,22,0);hill('#252e41',563,20,1);
    x.fillStyle='#f4e8d0';x.font='18px "Interlude Variable", sans-serif';x.fillText('EVENING,',42,53);x.fillText('IN COLOR',42,78);x.font='11px "Interlude Variable", sans-serif';x.fillText('ALBUM MESH — DEMO ARTWORK',42,600);
    await loadCover(await blobBytes(c),'Evening, in color · 예시');
  }
  function updateShaderUI(message) {
    shaderList=message.shaders||[];
    const select=$('shaderSelect'),old=state.shaderId;
    select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent=shaderList.length?'Shader fill을 선택하세요':'사용 가능한 Mesh gradient가 없어요';select.appendChild(empty);
    shaderList.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;select.appendChild(o);});
    state.shaderId=shaderList.some(s=>s.id===old)?old:(shaderList.find(s=>/mesh|메시|메쉬/i.test(s.name))||shaderList.find(s=>/16색/.test(s.name))||{}).id||'';
    select.value=state.shaderId;
    $('shaderState').textContent=state.shaderId?'연결됨':'준비 필요';$('shaderDot').classList.toggle('ready',!!state.shaderId);
    $('shaderHint').textContent=message.reason||(state.shaderId?'Shader 출력은 피그마에서 편집할 수 있지만 프리뷰와 색 퍼짐이 다릅니다. 기본 버튼은 PNG로 저장합니다.':'피그마 Tools에서 Mesh gradient를 찾아 사각형에 한 번 적용한 뒤 ↻를 눌러 주세요.');
    if(state.shaderId)post('inspect-shader',{id:state.shaderId});
    changed();
  }
  function compositeBytes() {
    // Copy the displayed pixels synchronously. Encoding may finish after the
    // next audio frame, so never pass the live canvas to the asynchronous encoder.
    const c=document.createElement('canvas');c.width=state.width;c.height=state.height;
    c.getContext('2d').drawImage($('phone').classList.contains('native')?$('nativeImage'):composite,0,0,state.width,state.height);return blobBytes(c);
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function drawCover(ctx,img,w,h,offset=0) {
    const ratio=Math.max(w/img.naturalWidth,h/img.naturalHeight),dw=img.naturalWidth*ratio,dh=img.naturalHeight*ratio;
    ctx.drawImage(img,offset+(w-dw)/2,offset+(h-dh)/2,dw,dh);
  }
  function renderComposite() {
    // One compositor supplies both the visible preview and exported PNG.
    // Reuse the buffers during playback; CSS and Figma add no second blur.
    const ctx=composite.getContext('2d');
    const pad=Math.ceil(state.blur*3)+1;
    if(!compositeUnder)compositeUnder=document.createElement('canvas');
    const under=compositeUnder;
    if(under.width!==state.width+pad*2||under.height!==state.height+pad*2){under.width=state.width+pad*2;under.height=state.height+pad*2;}
    const u=under.getContext('2d');
    const bg=M.albumTokens(state.palette).baseHex;u.fillStyle=bg;u.fillRect(0,0,under.width,under.height);
    if(coverImage&&state.coverOpacity>0){u.save();u.globalAlpha=state.coverOpacity;drawCover(u,coverImage,state.width,state.height,pad);u.restore();}
    u.globalAlpha=state.meshOpacity;u.globalCompositeOperation=state.meshBlendMode==='NORMAL'?'source-over':state.meshBlendMode.toLowerCase().replace('_','-');u.drawImage(fallbackCanvas||canvas,pad-12,pad-24,canvas.width,canvas.height);u.globalAlpha=1;u.globalCompositeOperation='source-over';
    // Extend the visible edge pixels, avoiding transparent blur borders in PNG export.
    u.drawImage(under,pad,pad,1,state.height,0,pad,pad,state.height);u.drawImage(under,pad+state.width-1,pad,1,state.height,pad+state.width,pad,pad,state.height);
    u.drawImage(under,0,pad,under.width,1,0,0,under.width,pad);u.drawImage(under,0,pad+state.height-1,under.width,1,0,pad+state.height,under.width,pad);
    ctx.globalAlpha=1;ctx.fillStyle=bg;ctx.fillRect(0,0,state.width,state.height);ctx.filter='blur('+state.blur+'px)';ctx.drawImage(under,-pad,-pad);ctx.filter='none';ctx.globalAlpha=state.veilOpacity;ctx.fillStyle=bg;ctx.fillRect(0,0,state.width,state.height);ctx.globalAlpha=1;
  }
  async function downloadComposite() {
    if(!coverImage)return notify('먼저 커버를 불러와 주세요.',true);
    const name='album-mesh-'+state.theme+'-'+state.width+'x'+state.height+'.png';
    download(new Blob([await compositeBytes()],{type:'image/png'}),name);
  }
  async function create(renderer='composite',preview=false) {
    if(!coverBytes||working)return;
    if(standalone){await downloadComposite();return;}
    setWorking(true);
    try {
      // Freeze the last painted frame before any asynchronous PNG conversion
      // or shader import. Paused audio retains that same painted frame.
      const message={settings:{...state,palette:state.palette.map(c=>({...c})),channelMix:{...state.channelMix}},snapshot:captureSnapshot(),coverBytes,sourceName,renderer};
      if(renderer==='composite')message.compositeBytes=await compositeBytes();
      if(preview){$('audio').pause();message.revision=revision;}
      post(preview?'native-preview':'create',message);
    }catch(e){setWorking(false);notify(e.message,true);}
  }
  function animate(now) {
    requestAnimationFrame(animate);
    if(document.hidden)return;
    const dt=Math.min(.1,Math.max(.001,(now-lastFrame)/1000));if(now-lastFrame<(gl?30:80))return;lastFrame=now;
    const hasAudio=!!audioURL,playing=hasAudio&&!$('audio').paused&&!$('audio').ended,running=playing&&audioContext&&audioContext.state==='running';
    if(running){analyser.getFloatFrequencyData(spectrum);analyser.getFloatTimeDomainData(waveform);metrics=reactor.update(A.features(spectrum,waveform,audioContext.sampleRate,analyser.fftSize),dt,state.sensitivity,state.bpm);}
    else metrics=reactor.update({rms:0,bass:0,percussion:0},dt,state.sensitivity,state.bpm);
    const moving=$('motion').checked&&!reduced.matches&&!$('phone').classList.contains('native')&&(!hasAudio||running);
    if(moving)frameTime+=dt;
    const bass=hasAudio?metrics.bass:Math.exp(-((frameTime*state.bpm/60)%1)*7),hit=hasAudio?metrics.hit:Math.exp(-(((frameTime*state.bpm/60+.5)%1))*11);
    const vocal=hasAudio?metrics.vocal:.45+.35*Math.sin(frameTime*.7),inst=hasAudio?metrics.instruments:.5+.3*Math.cos(frameTime*.31);
    const mix=state.channelMix,blend=(current,target,seconds)=>current+(target-current)*(1-Math.exp(-dt/seconds));
    if(moving){
      visualBass=blend(visualBass,M.clamp(bass*mix.bass),.14);visualHit=blend(visualHit,M.clamp(hit*mix.drums),.09);
      visualVocal=blend(visualVocal,M.clamp(vocal*mix.vocal),.3);visualInst=blend(visualInst,M.clamp(inst*mix.instruments),.5);
      if(!hasAudio||metrics.audible){flowTime+=dt;[visualBass,visualVocal,visualHit,visualInst].forEach((v,i)=>colorPhases[i]+=dt*v*[.9,.65,.8,.42][i]);}
      renderMesh(flowTime,visualBass,visualHit,true,visualVocal,visualInst,colorPhases);
      colorPoints(flowTime,visualBass,visualHit,true,visualVocal,visualInst,colorPhases);
    }
    if(now-lastHUD>180){lastHUD=now;
      $('bassMeter').value=hasAudio?metrics.bass:moving?bass:0;$('hitMeter').value=hasAudio?metrics.hit:moving?hit:0;
      $('vocalMeter').value=hasAudio?metrics.vocal:moving?vocal:0;$('instMeter').value=hasAudio?metrics.instruments:moving?inst:0;
      $('meter').querySelectorAll('i').forEach((b,i)=>b.style.height=(3+(moving?[bass,vocal,hit,inst][i%4]:0)*10)+'px');
      const status=hasAudio?(playing?(running?(metrics.audible?'4개 반응 분석 중':'무음 구간'):'오디오 연결 대기'):'오디오 일시정지'):'합성 데모';
      $('audioState').textContent=status+' · 저음 '+Math.round((hasAudio||moving?bass:0)*100)+' / 보컬 '+Math.round((hasAudio||moving?vocal:0)*100)+' / 드럼 '+Math.round((hasAudio||moving?hit:0)*100)+' / 악기 '+Math.round((hasAudio||moving?inst:0)*100);
      $('liveStatus').textContent=$('phone').classList.contains('native')?'피그마 정적 렌더 · 현재 색 저장':!$('motion').checked?'색 흐름 꺼짐':hasAudio&&!playing?'일시정지 · 현재 색 유지':status+' · 포인트 고정 · 색 흐름';
    }
  }

  async function loadAudio(file) {
    if(!file)return;if(file.size>100*1024*1024)throw new Error('100MB 이하의 오디오 파일을 사용해 주세요.');
    const a=$('audio');a.pause();if(audioURL)URL.revokeObjectURL(audioURL);reactor.reset();
    visualBass=visualHit=visualVocal=visualInst=flowTime=0;colorPhases=[0,0,0,0];
    audioURL=URL.createObjectURL(file);a.src=audioURL;a.classList.remove('hidden');$('clearAudio').classList.remove('hidden');$('audioName').textContent=file.name;
    if(!audioContext){audioContext=new(window.AudioContext||window.webkitAudioContext)();analyser=audioContext.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.05;spectrum=new Float32Array(analyser.frequencyBinCount);waveform=new Float32Array(analyser.fftSize);audioSource=audioContext.createMediaElementSource(a);audioSource.connect(analyser);analyser.connect(audioContext.destination);}
    $('motion').checked=!reduced.matches;
    if(reduced.matches)notify('동작 줄이기 설정이 켜져 있어 배경 움직임은 정지 상태입니다.');
    changed();notify('재생하면 앨범·가사 화면 모두 같은 색 흐름으로 반응합니다.');
  }
  const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){notify(e.message||String(e),true);}};
  $('viewportSize').onchange=()=>setViewport($('viewportSize').value);
  $('upload').onclick=()=>$('imageFile').click();
  $('imageFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';if(file)await loadCover(new Uint8Array(await file.arrayBuffer()),file.name);});
  $('sample').onclick=safe(sampleCover);
  $('selection').onclick=()=>{setWorking(true);post('use-selection');};
  $('resetPalette').onclick=()=>{if(!originalPalette.length)return;state.palette=originalPalette.map(c=>({...c}));drawPalette();changed();};
  const drop=$('dropzone');
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag');}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag');}));
  drop.addEventListener('drop',safe(async e=>{const file=e.dataTransfer.files[0];if(file)await loadCover(new Uint8Array(await file.arrayBuffer()),file.name);}));
  for(const key of ['coverOpacity','meshOpacity','veilOpacity','blur','bpm','motionAmount','pointVariation','sensitivity'])$(key).oninput=()=>{state[key]=Number($(key).value)/(key.endsWith('Opacity')||key==='pointVariation'?100:1);if(['coverOpacity','meshOpacity','veilOpacity','blur'].includes(key))state.preset='custom';changed();};
  document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{Object.assign(state,M.preset(b.dataset.preset));changed();});
  for(const key of ['bass','vocal','drums','instruments'])$(key+'Mix').oninput=()=>{state.channelMix[key]=Number($(key+'Mix').value)/100;$(key+'Mix').nextElementSibling.textContent=$(key+'Mix').value+'%';};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $('shuffle').onclick=()=>{state.seed=(state.seed+1)%10000;changed();};
  $('meshBlendMode').onchange=()=>{state.meshBlendMode=$('meshBlendMode').value;changed();};
  $('refreshShaders').onclick=()=>{if(!standalone){$('shaderState').textContent='확인 중';post('refresh-shaders');}};
  $('shaderSelect').onchange=()=>{state.shaderId=$('shaderSelect').value;shaderInfo=null;$('shaderDetails').textContent='속성 확인 중…';$('shaderState').textContent=state.shaderId?'연결됨':'준비 필요';$('shaderDot').classList.toggle('ready',!!state.shaderId);if(state.shaderId)post('inspect-shader',{id:state.shaderId});changed();};
  $('nativePreview').onclick=safe(()=>create('native',true));$('create').onclick=safe(()=>create());$('createNative').onclick=safe(()=>create('native'));
  $('toggleContent').onclick=()=>{const hidden=$('phone').classList.toggle('no-content');$('toggleContent').textContent=hidden?'콘텐츠 보이기':'콘텐츠 숨기기';};
  $('togglePoints').onclick=()=>{const on=$('phone').classList.toggle('show-points');$('togglePoints').classList.toggle('active',on);$('togglePoints').textContent=on?'포인트 숨기기':'포인트 보기';const s=captureSnapshot();colorPoints(s?s.time:0,s?s.bass:0,s?s.hit:0,!!s,s?s.vocal:0,s?s.instruments:0,s?s.phases:null);};
  $('exportJson').onclick=()=>download(new Blob([JSON.stringify({version:"1.11.0",sourceName,settings:state,tokens:M.albumTokens(state.palette),backgroundPaletteHex:M.ambientPalette(state.palette).map(M.hex),paletteHex:state.palette.map(M.hex),snapshot:captureSnapshot(),geometry:computeGeometry(captureSnapshot()),layoutWarp:M.layoutWarp(state),anchors:M.anchors(state.seed),colorField:{model:'fixed-mesh-color-transport',weightPower:M.FIELD_CONTRAST,sitesPerColor:2,period:[1.65,1.64]},motion:{previewOnly:true,model:'color-flow-v2',analysis:'four spectral/timbre proxies, not separated stems',channels:['bass','vocal','drums','instruments'],lowBandHz:[35,180],vocalBandHz:[300,3200],percussiveBandHz:[1200,8000],attackMs:22,releaseMs:Math.max(90,Math.min(200,60000/state.bpm*.36)),flowStrengthPercent:state.motionAmount},shader:shaderInfo?{name:shaderInfo.name,id:shaderInfo.id}:null},null,2)],{type:'application/json'}),'album-mesh-settings.json');
  $('motion').onchange=()=>{if(reduced.matches&&$('motion').checked){$('motion').checked=false;notify('시스템의 동작 줄이기 설정을 따르고 있습니다.');}lastFrame=performance.now();frameTime=flowTime=visualBass=visualHit=visualVocal=visualInst=0;colorPhases=[0,0,0,0];changed();};
  $('motionPreset').onclick=()=>{Object.assign(state,M.preset('balanced'),{motionAmount:100,sensitivity:1.2});$('motion').checked=!reduced.matches;changed();notify('포인트는 고정하고 네 가지 소리 반응으로 색을 흐르게 합니다.');};
  reduced.addEventListener('change',()=>{if(reduced.matches){$('motion').checked=false;changed();}});
  $('audioUpload').onclick=()=>$('audioFile').click();$('audioFile').onchange=safe(async e=>{const file=e.target.files[0];e.target.value='';await loadAudio(file);});
  $('audio').onplay=safe(async()=>{if(audioContext)await audioContext.resume();reactor.reset();$('motion').checked=!reduced.matches;lastFrame=performance.now();if($('phone').classList.contains('native'))changed();});
  $('audio').onseeked=()=>{reactor.reset();visualBass=visualHit=visualVocal=visualInst=flowTime=0;colorPhases=[0,0,0,0];};
  $('audio').onerror=()=>notify('이 오디오 형식은 재생할 수 없습니다. MP3 또는 WAV 파일로 다시 시도해 주세요.',true);
  $('clearAudio').onclick=()=>{const a=$('audio');a.pause();a.removeAttribute('src');a.load();a.classList.add('hidden');if(audioURL)URL.revokeObjectURL(audioURL);audioURL='';$('audioName').textContent='선택 사항 · 로컬 파일';$('clearAudio').classList.add('hidden');reactor.reset();};
  window.addEventListener('message',safe(async e=>{
    // Figma relays plugin messages through nested sandbox frames; event.source
    // is not consistently the immediate parent across desktop/web versions.
    const msg=e.data&&e.data.pluginMessage;if(!msg||typeof msg.type!=='string')return;
    if(msg.type==='selection'){selectionName=msg.count===1?msg.name:'';$('selection').title=selectionName?'선택됨: '+selectionName:'커버 레이어 하나를 선택하세요.';}
    else if(msg.type==='shaders')updateShaderUI(msg);
    else if(msg.type==='shader-diagnostics')$('shaderDetails').textContent=msg.summary;
    else if(msg.type==='cover'){try{await loadCover(new Uint8Array(msg.bytes),msg.name);}finally{setWorking(false);}}
    else if(msg.type==='shader-info'){
      if(msg.shader.id!==state.shaderId)return;shaderInfo=msg.shader;
      const defs=Object.entries(shaderInfo.definitions);$('shaderDetails').textContent=defs.map(([id,d])=>{
        const v=(shaderInfo.defaults||{})[id]||d.defaultValue;
        return d.name+' · '+d.type+(d.type==='COLOR_POINT'&&v?' · ('+Number(v.x).toFixed(1)+', '+Number(v.y).toFixed(1)+')':'');
      }).join('\n')||'편집 가능한 속성이 없습니다.';
      const colors=defs.filter(([,d])=>['COLOR','COLOR_POINT','GRADIENT'].includes(d.type)).length;
      $('shaderHint').textContent=colors+'개 속성 연결 · Shader는 편집 가능하며 프리뷰와 색 퍼짐이 다릅니다. 기본 출력은 PNG입니다.';
      refreshGeometry();
    }
    else if(msg.type==='native-preview'){
      if(msg.revision!==revision){setWorking(false);notify('설정이 변경되어 렌더 결과를 건너뛰었습니다. 다시 확인해 주세요.');return;}
      if(nativeURL)URL.revokeObjectURL(nativeURL);nativeURL=URL.createObjectURL(new Blob([new Uint8Array(msg.png)],{type:'image/png'}));$('nativeImage').src=nativeURL;
      try{await $('nativeImage').decode();}finally{setWorking(false);}
      if(msg.revision!==revision)return;nativeSnapshot=M.normalizeSnapshot(msg.snapshot);$('phone').classList.add('native');$('motion').checked=false;
      $('previewNote').textContent='피그마 실제 렌더 · '+msg.mapped+'색상 · '+(msg.snapshot&&msg.snapshot.model==='color-flow-v2'?'현재 색 · 포인트 고정':msg.geometry?msg.geometry.movedPoints+'개 기본 배치 변형':'')+(msg.geometry&&msg.geometry.edgeExtendedPoints?' · 외곽 확장':'')+' · 정적';
      refreshGeometry(nativeSnapshot);const s=nativeSnapshot;colorPoints(s?s.time:0,s?s.bass:0,s?s.hit:0,!!s,s?s.vocal:0,s?s.instruments:0,s?s.phases:null);
    }
    else if(msg.type==='created'){setWorking(false);notify(msg.width+' × '+msg.height+' 배경 생성 완료'+(msg.snapshot?' · 현재 색 흐름 저장':'')+(msg.shaderName?' · '+msg.shaderName+' · '+msg.mapped+'색상':''));}
    else if(msg.type==='error'){setWorking(false);notify(msg.message,true);}
  }));
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();notify('GPU 미리보기가 중단됐습니다. 플러그인을 다시 열어 주세요.',true);});
  window.addEventListener('pagehide',()=>{if(audioContext)audioContext.close();for(const url of [coverURL,nativeURL,audioURL])if(url)URL.revokeObjectURL(url);});
  try{initGL();}catch(e){gl=null;notify('소프트웨어 미리보기로 전환했습니다.');}
  drawPalette();changed();requestAnimationFrame(animate);
  new ResizeObserver(fitPreview).observe(document.querySelector('.preview-area'));fitPreview();
  if(standalone){
    $('shaderState').textContent='브라우저 데모';$('shaderSelect').replaceChildren(new Option('네이티브 Shader는 피그마에서 실행',''));$('shaderSelect').disabled=true;$('refreshShaders').disabled=true;
    $('shaderHint').textContent='이 HTML은 팔레트·레이어·움직임을 시험하는 데모입니다. 네이티브 Shader 생성은 manifest.json을 피그마에 가져온 뒤 사용할 수 있어요.';
    $('createNative').classList.add('hidden');$('footerNote').innerHTML='<strong>브라우저 데모</strong><br>선택한 크기로 프리뷰 그대로 PNG 저장';
    safe(sampleCover)();
  }else{post('init');safe(sampleCover)();}
})();
