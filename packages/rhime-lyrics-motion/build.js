const fs=require('node:fs'),path=require('node:path');
const root=__dirname,read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('src/core.js'),sample=read('sample.lrc');
const mesh=read('src/vendor/mesh-core.js')+'\n'+read('src/vendor/mesh-audio.js')+'\n'+read('src/mesh.js');
fs.writeFileSync(path.join(root,'code.js'),core+'\n'+mesh+'\n'+read('src/design.js')+'\n'+read('src/main.js'));
fs.writeFileSync(path.join(root,'ui.html'),read('src/ui.html').replace('/* FONT */',()=>fs.readFileSync(path.join(root,'assets/fonts/InterludeVariable-1.3.woff2')).toString('base64')).replace('/* CORE */',()=>core+'\n'+mesh+'\n'+read('src/mesh-renderer.js')).replace('/* SAMPLE */',()=>JSON.stringify(sample)).replace('/* UI */',()=>read('src/ui.js')));
console.log('Built Rhime Lyrics Motion: standalone UI + native Motion API.');
