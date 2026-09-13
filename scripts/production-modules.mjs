import fs from 'node:fs';
const packages=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).packages;
console.log(Object.entries(packages).filter(([name,p])=>name.startsWith('node_modules/')&&!p.dev).map(([name])=>name).join('\n'));
