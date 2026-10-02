const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const L=require('../src/core'),sample=fs.readFileSync('sample.lrc','utf8');
test('provided LRC preserves all 16 original timestamps and lyric text',()=>{
 const p=L.parse(sample);assert.equal(p.cues.length,16);assert.equal(p.cues[0].start,16.37);assert.equal(p.cues.at(-1).start,43.4);assert.equal(p.cues[0].text,'불러봐, 불러봐, 불러봐 줘 사인');assert.equal(p.warnings.length,0);
 const plan=L.compile(p,{},Array(16).fill(88));assert.equal(plan.duration,46.4);assert.equal(plan.rows[1].start,18.7);assert.equal(plan.rows[1].y,116);
});
test('multiple timestamps repeat the same line; equal timestamps become one simultaneous block',()=>{
 const p=L.parse('[00:02.00][00:04.00]Repeat\n[00:02.00]Other\n[00:02.00]Repeat');assert.deepEqual(p.cues,[{start:2,text:'Repeat\nOther'},{start:4,text:'Repeat'}]);
});
test('file offset is global even after timed lines; manual offset is applied once',()=>{
 const p=L.parse('[00:10.123]Hello\n[offset:-1000]');assert.equal(p.cues[0].start,9.123);assert.equal(L.timing(p,{syncOffset:500}).cues[0].start,9.623);
});
test('first-line mode subtracts origin without changing relative intervals',()=>{
 const p=L.parse(sample),t=L.timing(p,{fromFirst:true});assert.equal(t.origin,16.37);assert.equal(t.cues[0].start,0);assert.equal(t.cues[1].start,2.33);assert.equal(t.duration,30.03);
});
test('empty timed lines clear emphasis and keep scroll position',()=>{
 const plan=L.compile(L.parse('[00:01]A\n[00:02]\n[00:05]B'),{},[44,88]);assert.equal(plan.rows.length,2);
 assert.equal(L.valueAt(plan.rows[0].opacity,3),.32);assert.equal(L.valueAt(plan.scroll,3),0);
 assert.equal(L.valueAt(plan.rows[1].opacity,6),1);
});
test('rapid cues shorten transitions and produce sorted non-overlapping finite keyframes',()=>{
 const plan=L.compile(L.parse('[00:00.00]A\n[00:00.01]B\n[00:00.02]C'),{fromFirst:true,tail:.1},[44,44,44]);
 for(const tr of [plan.scroll,...plan.rows.flatMap(r=>[r.opacity,r.blur])]){
  tr.keyframes.forEach((k,i)=>{assert.ok(Number.isFinite(k.timelinePosition));assert.ok(k.timelinePosition>=0&&k.timelinePosition<=plan.duration);if(i)assert.ok(k.timelinePosition>tr.keyframes[i-1].timelinePosition);});
 }
});
test('active lyric is bright and sharp; preceding and following lyrics stay dim and blurred',()=>{
 const p=L.compile(L.parse(sample),{},Array(16).fill(44)),t=20.7;
 assert.equal(L.valueAt(p.rows[2].opacity,t),1);assert.equal(L.valueAt(p.rows[2].blur,t),0);
 for(const i of [1,3]){assert.equal(L.valueAt(p.rows[i].opacity,t),.32);assert.equal(L.valueAt(p.rows[i].blur,t),3);}
});
test('scroll targets use real text heights including wrapping and the configured gap',()=>{
 const p=L.compile(L.parse('[00:01]A\n[00:03]B\n[00:06]C'),{gap:12},[88,44,132]);
 assert.equal(L.valueAt(p.scroll,4),-100);assert.equal(L.valueAt(p.scroll,7),-156);
});
test('each property holds between transitions rather than slowly drifting throughout the lyric',()=>{
 const p=L.compile(L.parse('[00:10]A\n[00:20]B'),{},[44,44]);assert.equal(L.valueAt(p.rows[0].opacity,9),.32);assert.equal(L.valueAt(p.rows[0].opacity,15),1);assert.equal(L.valueAt(p.scroll,19),0);
});
test('malformed timestamps fail before generation; untimed headings produce an explicit warning',()=>{
 assert.throws(()=>L.parse('[00:99]Oops'),/1행/);assert.throws(()=>L.parse('untimed'),/시간과 가사/);assert.throws(()=>L.parse('[offset:no]\n[00:01]A'),/offset/);
 assert.equal(L.parse('Heading\n[00:01]A').warnings.length,1);
});
test('metadata and BOM are accepted; Enhanced LRC is explicitly reduced to line timing',()=>{
 const p=L.parse('\uFEFF[ar:Artist]\r\n[00:01.20]<00:01.20>A <00:01.50>B');assert.equal(p.metadata.ar,'Artist');assert.equal(p.cues[0].text,'A B');assert.equal(p.warnings.length,1);
});
test('size, timeline limits and unusable measured heights are validated',()=>{
 const s=L.normalize({width:NaN,height:100000,transition:-1,inactive:4,blur:Infinity});assert.equal(s.width,402);assert.equal(s.height,1600);assert.equal(s.inactive,1);assert.equal(s.blur,3);
 assert.throws(()=>L.parse('x'.repeat(262145)),/256KB/);assert.throws(()=>L.parse('[121:00]A'),/2시간/);assert.throws(()=>L.compile(L.parse('[00:01]A'),{},[0]),/높이/);
});
test('planner never mutates the parsed LRC or user settings',()=>{
 const p=L.parse(sample),before=JSON.stringify(p),s={fromFirst:true};L.compile(p,s);assert.equal(JSON.stringify(p),before);assert.deepEqual(s,{fromFirst:true});
});
test('custom Bézier preview solves time on the x axis instead of using time as the curve parameter',()=>{
 const b={x1:.22,y1:1,x2:.36,y2:1};
 // At parameter t=.5, this curve's x=.3425 and y=.875.
 assert.ok(Math.abs(L.curve(.3425,b)-.875)<1e-7);
 assert.equal(L.curve(0,b),0);assert.equal(L.curve(1,b),1);
 const tr={baseValue:{value:0},keyframes:[{timelinePosition:0,value:{value:0},easing:{type:'CUSTOM_CUBIC_BEZIER',easingFunctionCubicBezier:b}},{timelinePosition:1,value:{value:100},easing:{type:'HOLD'}}]};
 assert.ok(Math.abs(L.valueAt(tr,.3425)-87.5)<1e-5);
});
test('scroll, opacity and blur share the selected native Bézier while retaining holds',()=>{
 const b={x1:.22,y1:1,x2:.36,y2:1},p=L.compile(L.parse(sample),{bezier:b});
 for(const tr of [p.scroll,...p.rows.flatMap(r=>[r.opacity,r.blur])]){
  const transitions=tr.keyframes.filter(k=>k.easing.type!=='HOLD');assert.ok(transitions.length);
  for(const k of transitions){assert.equal(k.easing.type,'CUSTOM_CUBIC_BEZIER');assert.deepEqual(k.easing.easingFunctionCubicBezier,b);}
 }
 assert.equal(L.valueAt(p.scroll,18.5),0);assert.equal(L.valueAt(p.rows[2].opacity,20.7),1);assert.equal(L.valueAt(p.rows[2].blur,20.7),0);
 assert.deepEqual(b,{x1:.22,y1:1,x2:.36,y2:1});
});
test('Bézier values stay finite and bounded; legacy settings retain the previous curve',()=>{
 assert.deepEqual(L.normalize({}).bezier,{x1:.42,y1:0,x2:.58,y2:1});
 assert.deepEqual(L.normalize({bezier:{x1:-5,y1:Infinity,x2:8,y2:NaN}}).bezier,{x1:0,y1:0,x2:1,y2:1});
 for(const b of [{x1:0,y1:1,x2:0,y2:1},{x1:1,y1:0,x2:1,y2:0}])for(const x of [0,.000001,.25,.5,.999999,1]){const y=L.curve(x,b);assert.ok(Number.isFinite(y)&&y>=0&&y<=1);}
});
test('music extends the timeline while the final timed lyric returns to inactive after its tail',()=>{
 const p=L.compile(L.parse('[00:02.00]first\n[00:04.00]last'),{mediaDuration:20,tail:3});assert.equal(p.duration,20);assert.equal(L.valueAt(p.rows[1].opacity,8),.32);assert.equal(L.valueAt(p.rows[1].blur,8),3);
 const first=L.compile(L.parse('[00:02.00]first\n[00:04.00]last'),{mediaDuration:20,tail:3,fromFirst:true});assert.equal(first.duration,18);assert.equal(first.origin,2);
});
