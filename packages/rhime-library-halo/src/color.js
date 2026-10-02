/* Colour extraction shared by origin with Rhime Album Mesh; standalone copy, no runtime dependency. */
var LibraryColor = (function () {
  'use strict';
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const linear = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const gamma = (v) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const rgb = (c) => ({ r: clamp(finite(c && c.r, 0)), g: clamp(finite(c && c.g, 0)), b: clamp(finite(c && c.b, 0)) });
  function toLab(c) {
    const r = linear(c.r), g = linear(c.g), b = linear(c.b);
    const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
      1.9779984951*l - 2.428592205*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.808675766*s];
  }
  function rawFromLab(v) {
    const l = Math.pow(v[0] + 0.3963377774*v[1] + 0.2158037573*v[2], 3);
    const m = Math.pow(v[0] - 0.1055613458*v[1] - 0.0638541728*v[2], 3);
    const s = Math.pow(v[0] - 0.0894841775*v[1] - 1.291485548*v[2], 3);
    return {r: gamma(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
      g: gamma(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
      b: gamma(-0.0041960863*l - 0.7034186147*m + 1.707614701*s)};
  }
  const fromLab = v => rgb(rawFromLab(v));
  function toLch(c) {
    const [l,a,b]=toLab(c),chroma=Math.hypot(a,b);
    return {l,c:chroma,h:chroma<.00001?0:(Math.atan2(b,a)*180/Math.PI+360)%360};
  }
  // Reduce chroma at a fixed lightness/hue instead of clipping RGB channels.
  function fromLch({l,c,h}) {
    l=clamp(l);c=Math.max(0,c);const angle=h*Math.PI/180;
    const convert=chroma=>rawFromLab([l,chroma*Math.cos(angle),chroma*Math.sin(angle)]);
    const fits=v=>Object.values(v).every(n=>n>=0&&n<=1);
    let value=convert(c);if(fits(value))return value;
    let low=0,high=c;
    for(let i=0;i<24;i++){const mid=(low+high)/2;if(fits(convert(mid)))low=mid;else high=mid;}
    return rgb(convert(low));
  }
  const dist = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  const hex = (c) => '#' + [c.r,c.g,c.b].map(v => Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
  function parseHex(v) {
    if (!/^#?[0-9a-f]{6}$/i.test(v)) throw new Error('6자리 HEX 색상을 입력해 주세요.');
    const s = v.replace('#','');
    return {r: parseInt(s.slice(0,2),16)/255, g: parseInt(s.slice(2,4),16)/255, b: parseInt(s.slice(4,6),16)/255};
  }
  function extractPalette(data, count = 5) {
    const pixels = [];
    const stride = Math.max(1, Math.ceil(data.length / 4 / 6000));
    for (let i = 0; i < data.length; i += 4*stride) {
      if (data[i+3] < 128) continue;
      const lab = toLab({r:data[i]/255, g:data[i+1]/255, b:data[i+2]/255});
      pixels.push({lab, w:data[i+3]/255});
    }
    if (!pixels.length) throw new Error('불투명한 이미지 픽셀이 없습니다. 다른 커버를 선택해 주세요.');
    // Suppress white borders and black typography only if enough midtones remain.
    const middle = pixels.filter(p => p.lab[0] > 0.12 && p.lab[0] < 0.94);
    const samples = middle.length > pixels.length * 0.2 ? middle : pixels;
    const histogram = new Map();
    for (const p of samples) {
      p.w *= 0.8 + Math.min(0.8, Math.hypot(p.lab[1],p.lab[2])*3);
      const key = p.lab.map(v => Math.round(v*18)).join(',');
      const bin = histogram.get(key) || {sum:[0,0,0], w:0};
      bin.w += p.w;
      for (let j=0;j<3;j++) bin.sum[j] += p.lab[j]*p.w;
      histogram.set(key,bin);
    }
    const bins = Array.from(histogram.values()).sort((a,b) => b.w-a.w);
    const centers = [bins[0].sum.map(v=>v/bins[0].w)];
    // Weighted farthest-point initialization is deterministic and ignores tiny outliers.
    while (centers.length < Math.min(count,bins.length)) {
      let best = null, score = 0;
      for (const bin of bins) {
        const v = bin.sum.map(x => x/bin.w);
        const s = Math.min(...centers.map(c=>dist(c,v))) * Math.sqrt(bin.w);
        if (s > score) { score=s; best=v; }
      }
      if (!best || score < 0.00001) break;
      centers.push(best);
    }
    let groups = [];
    for (let iter=0;iter<12;iter++) {
      groups = centers.map(()=>({sum:[0,0,0],w:0}));
      for (const p of samples) {
        let k=0, d=Infinity;
        centers.forEach((c,j)=>{const next=dist(c,p.lab);if(next<d){d=next;k=j;}});
        groups[k].w += p.w;
        for(let j=0;j<3;j++) groups[k].sum[j] += p.lab[j]*p.w;
      }
      groups.forEach((g,i)=>{if(g.w)centers[i]=g.sum.map(v=>v/g.w);});
    }
    const ordered = centers.map((lab,i)=>({lab,weight:groups[i].w})).sort((a,b)=>b.weight-a.weight);
    const unique = [];
    for(const c of ordered) if(!unique.some(v=>dist(v.lab,c.lab)<0.002)) unique.push(c);
    const result = unique.map(c=>fromLab(c.lab));
    // A monochrome cover stays monochrome. Duplicate slots remain editable.
    while(result.length<count) result.push({...result[result.length % unique.length]});
    return result.slice(0,count);
  }
  return {clamp,rgb,toLab,fromLab,toLch,fromLch,hex,parseHex,extractPalette};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=LibraryColor;
