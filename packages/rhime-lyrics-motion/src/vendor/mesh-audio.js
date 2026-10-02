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
