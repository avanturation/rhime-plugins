const test=require('node:test'),assert=require('node:assert/strict'),A=require('../src/audio');
test('float spectrum features retain loud bass dynamics above the old -30dB ceiling',()=>{
  const bins=new Float32Array(1024).fill(-Infinity),wave=new Float32Array([.1,-.1]);
  bins[3]=-20;const soft=A.features(bins,wave,44100,2048);bins[3]=-10;const loud=A.features(bins,wave,44100,2048);
  assert.ok(loud.bass/soft.bass>3);assert.equal(loud.percussion,0);assert.equal(A.features(new Float32Array(1024).fill(-Infinity),new Float32Array(2048),44100,2048).rms,0);
});
test('a constant tone settles; repeated 150 BPM kicks retain distinct rises',()=>{
  const steady=A.createReactor(),kick=A.createReactor(),pulses=[];let held;
  for(let i=0;i<300;i++){
    held=steady.update({rms:.2,bass:.03,percussion:.001},1/30);
    const phase=(i/30*150/60)%1,amp=.03*Math.exp(-phase*10);
    pulses.push(kick.update({rms:.2,bass:amp,percussion:.001},1/30).bass);
  }
  assert.ok(held.hit<.001);assert.ok(held.bass<.3);
  const last=pulses.slice(-120);assert.ok(Math.max(...last)-Math.min(...last)>.4);
});
test('percussive input drives a separate channel and silence stops both channels',()=>{
  const r=A.createReactor();for(let i=0;i<60;i++)r.update({rms:.1,bass:.01,percussion:.001});
  const spike=r.update({rms:.4,bass:.01,percussion:.04});assert.ok(spike.hit>.7);assert.ok(spike.bass<.3);
  let quiet;for(let i=0;i<30;i++)quiet=r.update({rms:0,bass:0,percussion:0});assert.ok(quiet.bass<.001&&quiet.hit<.001);assert.equal(quiet.audible,false);
  r.reset();assert.equal(r.update({rms:0,bass:0,percussion:0}).events,0);
});

test('sustained midrange and upper harmonics produce distinct vocal/instrument proxies',()=>{
  const bins=new Float32Array(1024).fill(-Infinity),wave=new Float32Array([.1,-.1]);
  bins[Math.round(1000*2048/44100)]=-12;const mid=A.features(bins,wave,44100,2048);
  assert.ok(mid.vocal>0);assert.equal(mid.instruments,0);assert.equal(mid.bass,0);
  bins.fill(-Infinity);bins[Math.round(6000*2048/44100)]=-12;const high=A.features(bins,wave,44100,2048);
  assert.ok(high.instruments>0);assert.equal(high.vocal,0);assert.equal(high.bass,0);
  const r=A.createReactor();let held;
  for(let i=0;i<120;i++)held=r.update({...mid,rms:.2},1/30);
  assert.ok(held.vocal>.8);assert.ok(held.instruments<.001);assert.ok(held.drums<.001);
  for(let i=0;i<90;i++)held=r.update({rms:0},1/30);
  for(const key of ['bass','vocal','drums','instruments'])assert.ok(held[key]<.001);
});
test('drum onsets do not instantly turn into a sustained vocal or synth wash',()=>{
  const r=A.createReactor();for(let i=0;i<60;i++)r.update({rms:.1,bass:.01,percussion:.001,vocal:.001,instruments:.001});
  const before=r.update({rms:0}),spike=r.update({rms:.5,bass:.02,percussion:.1,vocal:.03,instruments:.08});
  assert.ok(spike.drums>.8);assert.ok(spike.vocal<.9);assert.ok(spike.instruments<.9);
  r.reset();const reset=r.update({rms:0});assert.equal(reset.vocal,0);assert.equal(reset.instruments,0);
});
