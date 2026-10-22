// Zieht RAW und LINES aus index.html und schreibt data.json
const fs=require("fs");
const src=fs.readFileSync(process.argv[2]||"index.html","utf8");
const m=src.match(/const RAW=(\[[\s\S]*?\n\]);\nconst LINES=(\[[\s\S]*?\n\]);/);
if(!m)throw new Error("RAW/LINES nicht gefunden");
const raw=eval(m[1]),lines=eval(m[2]);
const ver=parseInt(process.argv[3]||"0",10);
fs.writeFileSync(process.argv[4]||"data.json",JSON.stringify({ver,raw,lines}));
console.log("data.json:",raw.length,"Einträge, Version",ver);
