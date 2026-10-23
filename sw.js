const SHELL="stempel-shell-v14", TILES="stempel-tiles-v1", MAX_TILES=1500;
const ASSETS=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css","https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png","https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(SHELL).then(c=>Promise.allSettled(ASSETS.map(a=>c.add(a)))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>![SHELL,TILES].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function trimTiles(){const c=await caches.open(TILES);const keys=await c.keys();if(keys.length>MAX_TILES){await Promise.all(keys.slice(0,keys.length-MAX_TILES).map(k=>c.delete(k)))}}
self.addEventListener("fetch",e=>{const u=e.request.url;
  if(u.includes("tile.openstreetmap.org")){e.respondWith(caches.open(TILES).then(async c=>{const hit=await c.match(e.request);const net=fetch(e.request).then(r=>{if(r.ok){c.put(e.request,r.clone());trimTiles()}return r}).catch(()=>hit);return hit||net}));return}
  if(e.request.method!=="GET")return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok&&(u.startsWith(self.location.origin)||u.includes("unpkg.com"))){caches.open(SHELL).then(c=>c.put(e.request,r.clone()))}return r})))});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus" in c)return c.focus()}return clients.openWindow("./")}))});
