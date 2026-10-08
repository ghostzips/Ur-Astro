/* sw.js — service worker ของแผนที่ดวงเวอร์ชันมือถือ: เปิดได้เต็มรูปแบบเมื่อไม่มีเน็ต
 *
 * ยกกลยุทธ์มาจาก app/sw.js ที่ผ่านบทเรียนมาแล้ว (cache:"reload" · stale-while-revalidate · ห้ามแคชไฟล์เทสต์)
 * แต่แยกชื่อแคชคนละตัว (urmap-v*) จะได้ไม่ชนกับแอปยูเรเนียน แม้อยู่โดเมนเดียวกัน
 *
 * ขนาดที่ต้องโหลดตอนติดตั้ง ≈ 16 MB: ตารางดาว 10.5 + ละติจูดดาว 3.1 + แผนที่ระดับหยาบ/กลาง 2.1 + ที่เหลือ <1
 * แผนที่ระดับละเอียด (1:10m, 8.9 MB) **ไม่บังคับโหลดตอนติดตั้ง** — ดึงครั้งแรกที่ซูมถึงตอนมีเน็ต แล้วเก็บไว้ใช้ออฟไลน์
 */
const CACHE = "urmap-v20";
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
  "./events.js",
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
// ไฟล์ที่ "ไม่มีก็ต้องติดตั้งได้": คำอ่านเป็นตัวเลือกตอน deploy (ลิขสิทธิ์ — ดู deploy_map.sh)
// บั๊กจริง urmap-v1/v2 (21 ก.ย. 2026): ไฟล์นี้อยู่ใน FILES แบบบังคับ แต่ชุดที่ขึ้นเว็บไม่มี → 404 → install ล้มทั้งชุด
// แคชค้างครึ่งเดียว (18/23) และไม่มีใครเห็น เพราะหน้าเว็บขึ้น "พร้อมใช้ออฟไลน์" จาก SW ของแอปยูเรเนียนที่ครอบ /map/ อยู่
const OPTIONAL = new Set(["./readings.json.gz"]);
// โหลดเมื่อขอครั้งแรก แล้วเก็บไว้ (ไฟล์ใหญ่ ใช้เฉพาะตอนซูมลึก)
const ON_DEMAND = /\/geo\/(countries|states)-10m\.json$/;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache:"reload" — ไม่ให้ตรึงไฟล์เก่าจากแคช HTTP ของเบราว์เซอร์ไว้ในแคชของเรา (บทเรียนจาก app/sw.js)
    await Promise.all(FILES.map(async (f) => {
      let res;
      // ไฟล์ทางเลือก (คำอ่าน) ข้ามได้เฉพาะ 404 = ตั้งใจไม่ใส่ — เน็ตสะดุด/5xx ต้องล้มให้ติดตั้งใหม่
      // เดิมข้ามทุกความล้มเหลว → ขึ้น "พร้อมใช้ออฟไลน์" ทั้งที่ไม่มีคำอ่าน และไม่มีวันลงแคชจนกว่าจะบัมพ์ (ตรวจบั๊กรอบ 3)
      res = await fetch(f, { cache: "reload" });
      if (!res.ok) { if (OPTIONAL.has(f) && res.status === 404) return; throw new Error("โหลด " + f + " ไม่สำเร็จ: " + res.status); }
      await c.put(f, res);
    }));
    await self.skipWaiting();
  })());
});

// ลบแคชรุ่นอื่นของแผนที่ — เรียกตอน activate และทุกครั้งที่เปิดหน้า (navigate) ด้วย เพราะหน้า/SW รุ่นเก่าที่ยังทำงานค้าง
// ช่วงสลับรุ่นอาจเรียก caches.open(ชื่อรุ่นเก่า) ซึ่ง "สร้างแคชเปล่าขึ้นใหม่" หลัง activate ลบไปแล้ว (เจอจริง urmap-v15 ว่างค้างหลังขึ้น v16)
async function sweepOld() {
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("urmap-")) await caches.delete(k);
}

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await sweepOld();
    // เก็บกวาดสำเนาไฟล์ของแผนที่ที่หลงอยู่ในแคชของแอปอื่นบนโดเมนเดียวกัน (SW ของแอปยูเรเนียนขอบเขต /Ur-Astro/ เคยคุมหน้า /map/
    // ก่อน SW นี้ติดตั้งสำเร็จ และเก็บทุกไฟล์ same-origin ลงแคชของมัน ~16 MB) — ลบเฉพาะ URL ใต้ขอบเขตของเรา ไม่แตะไฟล์ของแอปนั้น
    const scope = self.registration.scope;
    for (const k of await caches.keys()) {
      if (k.startsWith("urmap-")) continue;
      const c = await caches.open(k);
      for (const req of await c.keys()) if (req.url.startsWith(scope)) await c.delete(req);
    }
    await self.clients.claim();
  })());
});

// ทุกไฟล์ cache-first — รุ่นใหม่มาพร้อมกันทั้งชุดเมื่อเลข CACHE เปลี่ยน (bump_map.sh + เทสต์บังคับว่าเลขตรงกัน)
// เดิมไฟล์โค้ดดึงรุ่นใหม่ทับทีละไฟล์เบื้องหลัง → index.html ใหม่อาจคู่กับ api.js เก่า (ตรวจบั๊กรอบ 3, 3 ต.ค. 2026)
// หน้าสอบเทียบ/fixture ต้องสดเสมอ ห้ามลงแคช — ไม่งั้นแก้เทสต์แล้วรันได้ของเก่าเงียบ ๆ (บทเรียนจากแอป)
// fix.html = หน้าซ่อม ต้องมาจากเน็ตเสมอ ห้ามลงแคชเด็ดขาด — เป็นทางเดียวที่ทะลุตัวจัดการออฟไลน์รุ่นเก่าที่ค้างอยู่ได้
const NEVER_CACHE = /\/(selftest\.html|uitest\.html|fix\.html|fixture\.json)$/;

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const path = new URL(e.request.url).pathname;
  if (NEVER_CACHE.test(path)) return;
  if (/^https?:\/\/tile\.openstreetmap\.org\//.test(e.request.url)) return;   // แผ่นภาพออนไลน์ไม่แคช (นโยบาย OSM)
  if (e.request.mode === "navigate") e.waitUntil(sweepOld());
  e.respondWith((async () => {
    // แคชของรุ่นนี้ถูกลบแล้ว = มีรุ่นใหม่มาแทน — ห้าม caches.open() (จะสร้างแคชเปล่าชื่อรุ่นเก่าขึ้นมาใหม่) ไปเน็ตตรง ๆ
    if (!(await caches.has(CACHE))) return fetch(e.request);
    // ค้น**เฉพาะแคชของเรา** — caches.match() แบบรวมค้นทุกแคชของโดเมนตามลำดับที่สร้าง จึงเจอ /map/index.html ตัวเก่าในแคช
    // urain-* ของแอปยูเรเนียนก่อนเสมอ → มือถือค้างหน้า v3 ทั้งที่ SW เป็น v5 และหน้าเก่าฟ้อง "ไฟล์ไม่ครบในแคช urmap-v3" (เจอจริง 21 ก.ย. 2026)
    const mine = await caches.open(CACHE);
    const hit = await mine.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(e.request);
    // คำอ่านที่ติดตั้งไม่ทัน (เน็ตสะดุดตอน install) ให้ลงแคชเมื่อโหลดสำเร็จครั้งแรก ไม่งั้นออฟไลน์ไม่มีคำอ่านจนกว่าจะบัมพ์
    if (res.ok && (ON_DEMAND.test(path) || /\/readings\.json\.gz$/.test(path))) mine.put(path.endsWith("readings.json.gz") ? "./readings.json.gz" : e.request, res.clone());
    return res;
  })());
});
