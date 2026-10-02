const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = file => fs.readFileSync(path.join(root, 'src', file), 'utf8');
const shared = read('color.js') + '\n' + read('core.js');
fs.writeFileSync(path.join(root, 'code.js'), shared + '\n' + read('main.js'));
const font = fs.readFileSync(path.join(root, 'assets/fonts/InterludeVariable-1.3.woff2')).toString('base64');
fs.writeFileSync(path.join(root, 'ui.html'), read('ui.html')
  .replace('/* FONT */', () => font)
  .replace('/* SHARED */', () => shared)
  .replace('/* UI */', () => read('ui.js')));
console.log('Built standalone Rhime Library Halo. No network or dependencies.');
