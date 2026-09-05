/* sw.js — service worker: ทำให้แอปเปิดได้เต็มรูปแบบเมื่อไม่มีเน็ต
 *
 * กลยุทธ์: cache-first ทุกไฟล์ในรายการ (แอปนี้ไม่มีข้อมูลที่ต้องสดใหม่เลย
 * ทุกอย่างคำนวณในเครื่อง) เปลี่ยน CACHE เมื่อปล่อยเวอร์ชันใหม่เพื่อล้างของเก่า
 */
const CACHE = "urain-v83";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./glyphs.js",
  "./places.js",
  "./engine.js",
  "./render.js",
  "./ephem.bin.gz",
  "./dict.json.gz",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // ไฟล์ตารางดาว 10 MB — ถ้าพลาดตัวใดตัวหนึ่งต้องรู้ ไม่ใช่ติดตั้งครึ่ง ๆ กลาง ๆ
    //
    // **ต้อง cache:"reload" ไม่ใช่ addAll() เปล่า ๆ** — addAll ยิงผ่านแคช HTTP
    // ของเบราว์เซอร์ ถ้าที่นั่นค้างไฟล์เก่าอยู่ service worker จะ **ตรึงของเก่า
    // ไว้ในแคชของตัวเองทั้งเวอร์ชัน** ผู้ใช้ได้ index.html ใหม่คู่กับ style.css เก่า
    // แล้วปุ่มที่พึ่งกฎ CSS ใหม่ก็กดไม่ได้ โดยไม่มีอะไรบอกว่าทำไม (เจอจริง)
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
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ไฟล์โค้ดเล็ก ๆ ใช้ stale-while-revalidate — คืนของในแคชทันที (ออฟไลน์ยังได้)
// แล้วดึงรุ่นใหม่มาทับไว้ใช้รอบหน้า · แก้จุดตายของ cache-first ล้วน:
// ถ้าลืมบัมพ์ CACHE ผู้ใช้จะค้างรุ่นเก่าถาวรจนกว่าจะล้างข้อมูลไซต์
// (ไฟล์ใหญ่ ephem.bin.gz/dict.json.gz ยัง cache-first ล้วน — ไม่ดึงซ้ำโดยไม่จำเป็น)
const FRESH = new Set(["", "index.html", "style.css", "glyphs.js", "places.js",
                       "engine.js", "render.js", "manifest.json"]);
function isFresh(url) {
  const u = new URL(url);
  if (u.origin !== location.origin) return false;
  return FRESH.has(u.pathname.split("/").pop());   // "" = ลงท้ายด้วย /
}

// ไฟล์เทสต์ต้องสดเสมอและห้ามลงแคช — ไม่งั้นแก้เทสต์แล้วรันได้ของเก่าเงียบ ๆ
// (เจอจริง: เพิ่ม assert ใหม่แล้วผลไม่เปลี่ยน เพราะ service worker คืนไฟล์เก่า)
const NEVER_CACHE = /\/uitest\.(js|html)$/;

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (NEVER_CACHE.test(new URL(e.request.url).pathname)) return;   // ปล่อยผ่านไปเน็ตตรง ๆ
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit && isFresh(e.request.url)) {
      // คืนของเก่าให้ทันที แล้วอัปเดตแคชเบื้องหลัง
      e.waitUntil((async () => {
        try {
          const res = await fetch(e.request, { cache: "no-cache" });
          // เขียนลงคีย์ที่ตัด query ทิ้ง — ตอนเสิร์ฟ match ด้วย ignoreSearch
          // ถ้าเขียนใต้ URL ที่พ่วง query คีย์มาตรฐานจะไม่ถูกอัปเดตเลย
          // แล้วหน้าเก่าถูกเสิร์ฟตลอดกาลสำหรับ URL ที่มี query (เจอจริงตอนพัฒนา)
          const key = new URL(e.request.url); key.search = "";
          if (res.ok) (await caches.open(CACHE)).put(key.href, res.clone());
        } catch (err) { /* ออฟไลน์ก็ใช้ของเก่าต่อไป */ }
      })());
      return hit;
    }
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      // **ห้าม await การเขียนแคชตรงนี้** — ถ้า put() ล้ม (พื้นที่เต็ม / โควตาหมด)
      // มันจะโยนออกไปทำให้ respondWith พังทั้งคำขอ กลายเป็น "Failed to fetch"
      // ทั้งที่เซิร์ฟเวอร์ตอบ 200 มาแล้ว · แคชเป็นแค่ของแถม ไม่ใช่เงื่อนไขของคำตอบ
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        e.waitUntil(caches.open(CACHE)
          .then((c) => c.put(e.request, res.clone()))
          .catch(() => { /* แคชไม่ได้ก็ช่างมัน คำตอบยังส่งได้ */ }));
      }
      return res;
    } catch (err) {
      // ออฟไลน์และไม่มีในแคช — ถ้าเป็นการเปิดหน้า ให้หน้าหลักไป
      if (e.request.mode === "navigate") {
        const idx = await caches.match("./index.html");
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
