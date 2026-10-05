// sw.js ที่ราก — "ตัวปิด" ของแอปยูเรเนียนรุ่นเก่า (ก่อน v133 แอปอยู่ที่ราก ตอนนี้ย้ายไป uranian/)
// มือถือที่ติดตั้งรุ่นเก่ามี service worker ขอบเขตรากค้างอยู่ — ไฟล์นี้แทนที่มันแล้ว:
//   1) ลบแคชของรุ่นที่อยู่ที่ราก (urain-v132 ลงไป) — ไม่แตะแคชรุ่นใหม่ใน uranian/ และแคชแผนที่ (urmap-)
//   2) ถอนตัวเอง แล้วพาหน้าที่เปิดอยู่ไปหน้าใหม่
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      const m = /^urain-v(\d+)$/.exec(k);
      if (m && +m[1] <= 132) await caches.delete(k);
    }
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" }))
      if (!/\/(uranian|map)\//.test(c.url)) c.navigate(new URL("uranian/", self.registration.scope).href);
  })());
});
