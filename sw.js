/* sw.js — service worker ของแผนที่ดวงเวอร์ชันมือถือ: เปิดได้เต็มรูปแบบเมื่อไม่มีเน็ต
 *
 * ยกกลยุทธ์มาจาก app/sw.js ที่ผ่านบทเรียนมาแล้ว (cache:"reload" · stale-while-revalidate · ห้ามแคชไฟล์เทสต์)
 * แต่แยกชื่อแคชคนละตัว (urmap-v*) จะได้ไม่ชนกับแอปยูเรเนียน แม้อยู่โดเมนเดียวกัน
 *
 * ขนาดที่ต้องโหลดตอนติดตั้ง ≈ 16 MB: ตารางดาว 10.5 + ละติจูดดาว 3.1 + แผนที่ระดับหยาบ/กลาง 2.1 + ที่เหลือ <1
 * แผนที่ระดับละเอียด (1:10m, 8.9 MB) **ไม่บังคับโหลดตอนติดตั้ง** — ดึงครั้งแรกที่ซูมถึงตอนมีเน็ต แล้วเก็บไว้ใช้ออฟไลน์
 */
const CACHE = "urmap-v1";
const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
  "./glyphs.js",
  "./engine.js",
  "./acg.js",
  "./reading.js",
  "./meanings.js",
  "./places.js",
  "./timing.js",
  "./api.js",
  "./ephem.bin.gz",
  "./beta.bin.gz",
  "./dict.json.gz",
  "./house_dict.json",
  "./names.json",
  "./readings.json.gz",
  "./geo/countries-110m.json",
  "./geo/countries-50m.json",
  "./geo/states-50m.json",
  "./geo/cities.json",
  "./geo/admin1-labels.json",
];
// โหลดเมื่อขอครั้งแรก แล้วเก็บไว้ (ไฟล์ใหญ่ ใช้เฉพาะตอนซูมลึก)
const ON_DEMAND = /\/geo\/(countries|states)-10m\.json$/;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache:"reload" — ไม่ให้ตรึงไฟล์เก่าจากแคช HTTP ของเบราว์เซอร์ไว้ในแคชของเรา (บทเรียนจาก app/sw.js)
    await Promise.all(FILES.map(async (f) => {
      const res = await fetch(f, { cache: "reload" });
      if (!res.ok) throw new Error("โหลด " + f + " ไม่สำเร็จ: " + res.status);
      await c.put(f, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("urmap-")) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ไฟล์โค้ดเล็ก: คืนของในแคชทันที แล้วดึงรุ่นใหม่มาทับไว้ใช้รอบหน้า (ลืมบัมพ์ CACHE ก็ยังไม่ค้างถาวร)
// ไฟล์ใหญ่ (ตารางดาว/แผนที่/พจนานุกรม) cache-first ล้วน
const FRESH = new Set(["", "index.html", "manifest.json", "glyphs.js", "engine.js", "acg.js", "reading.js",
                       "meanings.js", "places.js", "timing.js", "api.js", "house_dict.json"]);
const isFresh = (url) => { const u = new URL(url); return u.origin === location.origin && FRESH.has(u.pathname.split("/").pop()); };
// หน้าสอบเทียบ/fixture ต้องสดเสมอ ห้ามลงแคช — ไม่งั้นแก้เทสต์แล้วรันได้ของเก่าเงียบ ๆ (บทเรียนจากแอป)
const NEVER_CACHE = /\/(selftest\.html|fixture\.json)$/;

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const path = new URL(e.request.url).pathname;
  if (NEVER_CACHE.test(path)) return;
  if (/^https?:\/\/tile\.openstreetmap\.org\//.test(e.request.url)) return;   // แผ่นภาพออนไลน์ไม่แคช (นโยบาย OSM)
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit && isFresh(e.request.url)) {
      e.waitUntil((async () => {
        try {
          const res = await fetch(e.request, { cache: "no-cache" });
          const key = new URL(e.request.url); key.search = "";
          if (res.ok) (await caches.open(CACHE)).put(key.href, res.clone());
        } catch (err) { /* ออฟไลน์ก็ใช้ของเก่าต่อไป */ }
      })());
      return hit;
    }
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok && ON_DEMAND.test(path)) (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  })());
});
