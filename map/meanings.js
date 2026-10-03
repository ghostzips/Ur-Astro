/* meanings.js — ตรรกะค้นหาคำอ่าน (พอร์ตจาก ui/meanings.py + server.tnp_line_reading) บนข้อมูล readings.json.gz
 *
 * ข้อมูลถูกแช่แข็งโดย tools/gen_readings.py — ที่นี่พอร์ตเฉพาะ "วิธีค้น" ห้ามแต่งข้อความเพิ่ม
 * ทุกฟังก์ชันต้องให้ผลเท่ากับฝั่ง Python คำต่อคำ (ตรวจใน selftest.html กับ fixture "lookups")
 */
(function (root) {
  "use strict";
  let D = null;                       // ข้อมูลจาก readings.json.gz

  // ชุดว่าง — ใช้เมื่อ deploy ไม่ได้ใส่ readings.json.gz (ค่าเริ่มของ deploy_map.sh เพราะเป็นข้อความที่สกัดจากแหล่งของคนอื่น)
  // เส้น/paran/ดวงย้ายเมืองยังคำนวณได้ครบ แค่ไม่มีคำอ่าน — ทุกฟังก์ชันคืน "ไม่มี" อย่างซื่อสัตย์ ไม่พัง
  // นิยามเป้าหมาย (ชื่อ/มุม/คำค้น) เป็นค่าตั้ง ไม่ใช่ข้อความจากตำรา — ต้องมีเสมอแม้ไม่ได้ใส่ไฟล์คำอ่าน
  // เดิมอยู่ในไฟล์คำอ่านอย่างเดียว → deploy แบบไม่มีคำอ่าน ปุ่มเป้าหมายหายและส่งเป้าหมายถูกปฏิเสธ (ตรวจบั๊กรอบ 3)
  // ต้องตรง ui/meanings.py GOALS ทุกตัวอักษร (เทสต์บังคับ)
  const GOALS = {"career": {"th": "งาน ชื่อเสียง ธุรกิจ", "angle": "MC", "kw": ["ชื่อเสียงในงาน", "เปิดธุรกิจ", "ประชาสัมพันธ์", "เปิดตัวผลงาน"]}, "love": {"th": "ความรัก คู่ครอง", "angle": "DC", "kw": ["ความรัก", "คู่ครอง"]}, "home": {"th": "บ้าน ครอบครัว ปักหลัก", "angle": "IC", "kw": ["บ้าน", "ครอบครัว", "ปักหลัก", "เกษียณ"]}, "self": {"th": "ตัวตน ร่างกาย สุขภาพ", "angle": "AC", "kw": ["ผ่าตัด", "หัตถการ", "ร่างกาย", "สุขภาพ"]}, "start": {"th": "เริ่มต้น ยังไม่รู้จะดูอะไร", "angle": null, "kw": ["ผู้เริ่มต้น", "มือใหม่"]}};
  const EMPTY = () => ({ _missing: true, line_meanings: {}, paran_meanings: [], astrocom: {}, ac_code: {}, merged: {}, readings: {},
                         goals: GOALS, goal_advice: [], sect_advice: [], orb_rules: [], timing_rules: [], tnp_factor: {} });
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
    const path = String(url).split(/[?#]/)[0];
    if (/\.gz$/.test(path) && typeof DecompressionStream === "function") {
      return JSON.parse(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text());
    }
    return JSON.parse(await res.text());
  }
  /** โหลด names.json (บังคับ) + readings.json.gz (ตัวเลือก)
   *  แยก "ไม่ได้ใส่ไฟล์" (404 — ตั้งใจ) ออกจาก "โหลดไม่สำเร็จ" (เน็ตสะดุด/ไฟล์เสีย): อย่างหลังลองซ้ำ 2 ครั้งก่อนยอม
   *  และบอกผู้ใช้ตามจริง — เดิมทุกความผิดพลาดกลายเป็น "ไม่ได้ใส่ไฟล์คำอ่าน" ถาวรทั้งที่ไฟล์มีอยู่ (ตรวจบั๊ก 29 ก.ย. 2026)
   *  เก็บ promise ไว้ เรียกซ้อนพร้อมกันจะไม่ยิงโหลดซ้ำ */
  let pending = null;
  function load(url, namesUrl) {
    if (D) return Promise.resolve(D);
    if (pending) return pending;
    pending = (async () => {
      const names = await fetchJson(namesUrl || "./names.json");
      let data = null, lastErr = null;
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        try { data = await fetchJson(url); }
        catch (e) {
          lastErr = e;
          if (e.status === 404) break;                     // ตั้งใจไม่ใส่ไฟล์ — ไม่ต้องลองซ้ำ
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      D = data || Object.assign(EMPTY(), lastErr && lastErr.status !== 404 ? { _loadError: String(lastErr.message || lastErr) } : {});
      D.names = names;
      return D;
    })();
    pending.catch(() => { pending = null; });      // names.json ล้ม → ให้เรียกใหม่ได้ (ไม่ตรึงความล้มเหลวไว้)
    return pending;
  }
  const ready = () => !!D;
  const missing = () => !!(D && D._missing);
  const loadError = () => (D && D._loadError) || null;       // โหลดไม่สำเร็จ (ไม่ใช่ตั้งใจไม่ใส่ไฟล์)
  const need = () => { if (!D) throw new Error("ยังไม่ได้โหลด readings.json.gz"); return D; };

  /** คำสอนของเส้นดาวนั้นที่มุมนั้น: เฉพาะมุม + ความหมายทั่วไปของดาว (for_line) */
  function forLine(code, angle) {
    const body = need().line_meanings[code] || {};
    return [...(body[angle] || []).map((x) => ({ ...x, scope: "มุมนี้" })),
            ...(body["ทั่วไป"] || []).map((x) => ({ ...x, scope: "ดาวนี้ทั่วไป" }))];
  }
  /** คำสอนคู่ paran (for_paran) — ลำดับดาวไม่สำคัญ */
  function forParan(a, b) {
    return need().paran_meanings.filter((x) => (x.pair[0] === a && x.pair[1] === b) || (x.pair[0] === b && x.pair[1] === a));
  }
  const acInv = () => { const d = need(); const inv = {}; for (const k in d.ac_code) inv[d.ac_code[k]] = k; return inv; };
  /** สรุป astro.com ของเส้น (ac_line) */
  function acLine(code, angle) {
    const k = acInv()[code];
    return k ? (need().astrocom[`${k}_${angle.toLowerCase()}`] || null) : null;
  }
  /** จุดตัดสองเส้นของ astro.com (ac_crossing) — คีย์เรียงตามลำดับดาวคงที่ของเขา */
  function acCrossing(a, b) {
    const d = need(), inv = acInv(), order = Object.keys(d.ac_code);
    let x = inv[a], y = inv[b];
    if (!x || !y || x === y) return null;
    if (order.indexOf(x) > order.indexOf(y)) [x, y] = [y, x];
    return d.astrocom[`${x}_${y}`] || null;
  }
  const forMerged = (code, angle) => need().merged[`${code}.${angle}`] || [];
  const forReading = (code, angle) => need().readings[`${code}.${angle}`] || null;
  /** บรรทัดคำแนะนำที่ตรงกับเป้าหมาย (advice_for) — จับจากคำในสกิล */
  function adviceFor(goal) {
    const d = need(), kw = (goals()[goal] || {}).kw || [];
    return d.goal_advice.filter((r) => kw.some((k) => r.text.includes(k)));
  }
  const goals = () => { const g = need().goals; return g && Object.keys(g).length ? g : GOALS; };
  const sectAdvice = () => need().sect_advice;
  const orbRules = () => need().orb_rules;
  const timingRules = () => need().timing_rules;
  const names = () => need().names;

  /** คำอ่านเส้นของดาวสมมติยูเรเนียน — ประกอบจากสองแหล่งวางคู่กัน (server.tnp_line_reading) ไม่หลอมประโยคใหม่ */
  function tnpLineReading(code, angle) {
    const d = need(), f = d.tnp_factor[code];
    if (!d.names.tnp.includes(code) || !f) return null;
    const ang = forLine("ANG", angle).filter((m) => m.scope === "มุมนี้" && m.kind === "สอน").slice(0, 3)
      .map((m) => ({ text: m.text, cites: m.cites || [] }));
    return {
      planet: { th: f.th, core: f.core, strength: f.strength, caution: f.caution },
      planet_source: "พจนานุกรม AISTRO — ความหมายของดาวดวงนี้ในดวงกำเนิด ไม่ใช่คำสอนเรื่องเส้นบนแผนที่",
      angle: ang, angle_source: "ความหมายของมุมจากสกิลแผนที่ดวง (Helena Woods)",
      note: "สองสำนักไม่มีคำสอน \"เส้น\" ของดาวสมมติยูเรเนียน — ที่แสดงคือความหมายของดาว (AISTRO) "
          + "กับความหมายของมุม (แผนที่ดวง) วางคู่กันให้อ่านประกอบเอง ระบบไม่หลอมเป็นคำทำนายใหม่",
    };
  }
  /** ข้อมูลคำอ่านที่แนบไปกับทุกเส้น (server._enrich) */
  const enrich = (code, angle) => ({ reading: forReading(code, angle), astrocom: acLine(code, angle), tnp: tnpLineReading(code, angle) });

  root.MEANINGS = { load, ready, missing, loadError, forLine, forParan, acLine, acCrossing, forMerged, forReading, adviceFor,
                    goals, sectAdvice, orbRules, timingRules, names, tnpLineReading, enrich, data: () => D };
})(typeof globalThis !== "undefined" ? globalThis : this);
