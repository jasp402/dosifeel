const fs=require('node:fs');
fs.mkdirSync('public',{recursive:true});
const revision=(process.env.VERCEL_GIT_COMMIT_SHA||process.env.GIT_COMMIT||'local').slice(0,8);
const html=fs.readFileSync('index.html','utf8').replaceAll('__COMMIT_HASH__',revision);
fs.writeFileSync('public/index.html',html);
fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'),'public/gsap.min.js');
console.log('DosiFeel build revision:',revision);

require('esbuild').buildSync({entryPoints:['src/experience.jsx'],bundle:true,minify:true,format:'iife',platform:'browser',target:'es2020',outfile:'public/experience.js'});
