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
