/* api.js — "เซิร์ฟเวอร์ในเบราว์เซอร์": ให้ผลลัพธ์รูปเดียวกับ /api/chart /api/dynamic /api/window /api/reading /api/city
 * ของ ui/server.py ทุกฟิลด์ เพื่อให้หน้า index.html ของ PC ยกมาใช้ได้โดยเปลี่ยนแค่ post() → API.call()
 *
 * พอร์ตตรงจาก ui/server.py — การตรวจอินพุต (BadInput) · ข้อ 1–6 · when_where · /api/city (crossings, A/B)
 * ตรวจค่าต่อค่ากับผลจริงของ Flask ใน selftest.html (fixture "endpoints")
 */
(function (root) {
  "use strict";
  const A = () => root.AISTRO, G = () => root.ACG, RD = () => root.READING, T = () => root.TIMING, M = () => root.MEANINGS;
  const mod360 = (v) => ((v % 360) + 360) % 360;
  const wrap180 = (v) => ((v + 180) % 360 + 360) % 360 - 180;
  const MI = 1.609344, FULL_MI = 150.0, MID_MI = 300.0, PARAN_ORB_DEG = 1.0;
  const METHODS = ["mundo", "eclpr"];
  const SIGNS = ["เมษ", "พฤษภ", "เมถุน", "กรกฎ", "สิงห์", "กันย์", "ตุลย์", "พิจิก", "ธนู", "มังกร", "กุมภ์", "มีน"];
  // ชื่อไทยของปัจจัยยูเรเนียน (relocation/report.py TH) — ต่างจาก names.th ตรง NO/AS/MC/AR
  const RTH = { AR: "จุดเมษ", MC: "เมริเดียน", AS: "ลัคนา", SU: "อาทิตย์", MO: "จันทร์", NO: "ราหู",
                ME: "พุธ", VE: "ศุกร์", MA: "อังคาร", JU: "พฤหัส", SA: "เสาร์", UR: "ยูเรนัส",
                NE: "เนปจูน", PL: "พลูโต", CU: "คิวปิโด", HA: "เฮเดส", ZE: "ซุส", KR: "โครนอส",
                AP: "อพอลลอน", AD: "แอดเมทอส", VU: "วัลคานัส", PO: "โพไซดอน", LM: "LM", LA: "LA" };

  class BadInput extends Error {}
  const num = (d, key, lo, hi, what) => {
    if (!(key in d)) throw new BadInput(`ไม่ได้ส่ง ${what}`);
    const v = Number(d[key]);
    if (d[key] === null || d[key] === "" || Number.isNaN(v)) throw new BadInput(`${what} ต้องเป็นตัวเลข (ได้ ${JSON.stringify(d[key])})`);
    if (!(lo <= v && v <= hi)) throw new BadInput(`${what} ต้องอยู่ระหว่าง ${lo} ถึง ${hi} (ได้ ${v})`);
    return v;
  };
  function parseDate(s, what) {
    const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ""));
    if (!m) throw new BadInput(`${what} ต้องเป็นรูปแบบ YYYY-MM-DD`);
    const y = +m[1], mo = +m[2], d = +m[3];
    const jd = A().julday(y, mo, d, 0.0), back = A().revjul(jd);
    if (back[0] !== y || back[1] !== mo || back[2] !== d) throw new BadInput(`${what}ไม่มีอยู่จริง (${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")})`);
    return [jd, `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`];
  }
  function parseBirth(d) {
    const dm = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(String(d.date || "")), tm = /^(\d{1,2}):(\d{2})$/.exec(String(d.time || ""));
    if (!dm || !tm) throw new BadInput("วันเกิด/เวลาเกิดต้องเป็นรูปแบบ YYYY-MM-DD และ HH:MM");
    const y = +dm[1], mo = +dm[2], da = +dm[3], hh = +tm[1], mm = +tm[2];
    if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && hh <= 23 && mm <= 59)) throw new BadInput(`วันเกิด/เวลาเกิดไม่มีอยู่จริง (${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")})`);
    const back = A().revjul(A().julday(y, mo, da, 0.0));
    if (back[0] !== y || back[1] !== mo || back[2] !== da) throw new BadInput(`วันเกิดไม่มีอยู่จริง (${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")})`);
    return { y, m: mo, d: da, hour: hh + mm / 60, hour_txt: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
             tz: num(d, "tz", -14, 14, "เขตเวลา"), lat: num(d, "lat", -89.5, 89.5, "ละติจูดที่เกิด"), lon: num(d, "lon", -180, 180, "ลองจิจูดที่เกิด") };
  }
  const jdOf = (b) => A().julday(b.y, b.m, b.d, b.hour - b.tz);
  const kindsOf = (body, dflt) => {
    const k = body.kinds;
    if (k === undefined || k === null || (Array.isArray(k) && !k.length)) return (dflt || []).slice();
    if (!Array.isArray(k) || !k.every((x) => x === "transit" || x === "progressed")) throw new BadInput("kinds ต้องเป็นรายการของ transit และ/หรือ progressed");
    return [...new Set(k)];
  };
  const methodOf = (body) => { const m = body.method === undefined ? "mundo" : body.method; if (!METHODS.includes(m)) throw new BadInput(`วิธีคำนวณเส้นต้องเป็น ('mundo', 'eclpr')`); return m; };
  const orbOf = (body) => "orb_km" in body ? num(body, "orb_km", 1, 5000, "ระยะที่ถือว่าใกล้เมือง") : 240.0;
  const rangeOf = (body) => {
    const [jdA, from] = parseDate(body.date_from, "วันเริ่มช่วง"), [jdB, to] = parseDate(body.date_to, "วันจบช่วง");
    if (jdB < jdA) throw new BadInput("วันจบช่วงต้องไม่ก่อนวันเริ่มช่วง");
    const days = Math.floor(jdB - jdA) + 1;
    if (days > 400) throw new BadInput(`ช่วงเวลายาวเกินไป (${days} วัน) — ไม่เกิน 400 วัน`);
    return { jdA, from, to, days };
  };
  const cityOf = (c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new BadInput("ไม่ได้ส่งข้อมูลเมือง");
    return { name: String(c.name === undefined ? "เมืองที่เลือก" : c.name), lat: num(c, "lat", -89.5, 89.5, "ละติจูดของเมือง"), lon: num(c, "lon", -180, 180, "ลองจิจูดของเมือง") };
  };
  /** R.deg ของ Python: "09°06′ ธนู (249.104°)" */
  function deg(x) {
    x = mod360(x);
    const s = Math.floor(x / 30), r = x - s * 30;
    const mins = Math.round((r % 1) * 60) % 60;
    return `${String(Math.floor(r)).padStart(2, "0")}°${String(mins).padStart(2, "0")}′ ${SIGNS[s]} (${x.toFixed(3)}°)`;
  }

  // ── สถานที่ (ตรง server.load_places จาก places.js) ──────────────────────────
  function places() {
    const P = root.URAN_PLACES;
    return { th: P.th.map(([name, lat, lon]) => ({ name, lat, lon, tz: 7.0 })),
             intl: P.intl.flatMap(([country, list]) => list.map(([name, lat, lon, tz]) => ({ name: `${name} (${country})`, lat, lon, tz }))) };
  }

  const N = () => M().names();
  const enrich = (code, angle) => M().enrich(code, angle);

  // ── /api/chart ───────────────────────────────────────────────────────────
  function chart(body) {
    const b = parseBirth(body), method = methodOf(body), jd = jdOf(b), g = G().gast(jd), n = N();
    const lines = [];
    for (const code of n.line_bodies) {
      const [ra, dec] = G().bodyEqu(jd, code, method);
      for (const ang of G().ANGLES) lines.push({ body: code, th: n.th[code], glyph: n.glyph[code], group: n.group[code], angle: ang, segments: G().polyline(ang, ra, dec, g, 1.0) });
    }
    const parans = RD().mapParans(jd, n.bodies, method).map((p) => ({ ...p, a_th: n.th[p.a], b_th: n.th[p.b] }));
    return { lines, parans, gast: g, method };
  }
  // ── /api/dynamic ─────────────────────────────────────────────────────────
  function dynamic(body) {
    const b = parseBirth(body), method = methodOf(body), kinds = kindsOf(body), n = N();
    const [jdOn, dateOn] = parseDate(body.date_on, "วันที่ดูจร");
    const jdB = jdOf(b), out = { date_on: dateOn, method, layers: {} };
    for (const kind of kinds) {
      const sets = kind === "transit" ? G().transitLines(jdB, jdOn, n.bodies, method) : G().progressedLines(jdB, jdOn, n.bodies, method);
      const lines = [];
      for (const code in sets) { const v = sets[code]; for (const ang of G().ANGLES) lines.push({ body: code, th: n.th[code], glyph: n.glyph[code], angle: ang, segments: G().polyline(ang, v.ra, v.dec, v.gast, 1.0) }); }
      out.layers[kind] = lines;
    }
    return out;
  }
  // ── ข้อ 3: เส้นที่ยังส่งผลจริง (_kept_lines) ────────────────────────────────
  function keptLines(lines, clat, clon) {
    const n = N();
    const rows = G().linesNear(clat, clon, lines, MID_MI * MI).map((h) => {
      const mi = h.km / MI;
      return { ...h, th: n.th[h.body], glyph: n.glyph[h.body], group: n.group[h.body], mi, level: mi <= FULL_MI ? "เต็มกำลัง" : "ปานกลาง",
               reading: M().forReading(h.body, h.angle), tnp: M().tnpLineReading(h.body, h.angle) };
    });
    const weak = G().linesNear(clat, clon, lines, 966.0).filter((h) => h.km / MI > MID_MI)
      .map((h) => ({ th: n.th[h.body], glyph: n.glyph[h.body], angle: h.angle, km: h.km, mi: h.km / MI }));
    return [rows, weak];
  }
  // ── /api/window ──────────────────────────────────────────────────────────
  function windowApi(body) {
    const b = parseBirth(body), city = cityOf(body.city), method = methodOf(body), orbKm = orbOf(body), n = N();
    const { jdA, from, to, days } = rangeOf(body), jdB = jdOf(b);
    const lines = G().lineSet(jdB, jdB, n.line_bodies, method);
    const natal = G().linesNear(city.lat, city.lon, lines, orbKm).map((h) => ({ ...h, th: n.th[h.body], glyph: n.glyph[h.body], ...enrich(h.body, h.angle) }));
    let kinds = kindsOf(body); const kindsDefaulted = !kinds.length; kinds = kinds.length ? kinds : ["transit"];
    const [kept] = keptLines(lines, city.lat, city.lon);
    const tm = T().timing(jdB, city.lat, city.lon, method, orbKm, jdA, days, kinds, kept, enrich, n, M().timingRules());
    const { spans, ...rest } = tm;
    return { city, date_from: from, date_to: to, days, orb_km: orbKm, method, kinds, kinds_defaulted: kindsDefaulted, natal_near: natal, spans, timing: rest };
  }
  // ── /api/reading ─────────────────────────────────────────────────────────
  function reading(body) {
    const b = parseBirth(body), method = methodOf(body), orbKm = orbOf(body), jd = jdOf(b), n = N();
    const lines = G().lineSet(jd, jd, n.line_bodies, method);
    const row = (h) => ({ ...h, th: n.th[h.body], glyph: n.glyph[h.body], group: n.group[h.body], reading: M().forReading(h.body, h.angle), tnp: M().tnpLineReading(h.body, h.angle) });
    const near = G().linesNear(b.lat, b.lon, lines, orbKm).map(row);
    const far = G().linesNear(b.lat, b.lon, lines, 5000.0).slice(0, 6).map(row);
    const goals = M().goals();
    // ── ข้อ 2 ──
    let step2 = null;
    const goal = body.goal;
    if (goal) {
      if (typeof goal !== "string" || !(goal in goals)) throw new BadInput(`เป้าหมายต้องเป็นหนึ่งใน [${Object.keys(goals).map((g) => `'${g}'`).join(", ")}]`);
      const spec = goals[goal], advice = M().adviceFor(goal);
      const sc = RD().sectOf(jd, b.lat, b.lon);
      let pairs = advice.flatMap((r) => r.pairs.map((p) => [p[0], p[1]]));
      if (!pairs.length) {
        const planets = [...new Set(advice.flatMap((r) => r.planets))]; const pl = planets.length ? planets : ["SU", "VE", "JU"];
        const angles = spec.angle ? [spec.angle] : G().ANGLES.slice();
        pairs = pl.flatMap((c) => angles.map((a) => [c, a]));
      }
      const seen = new Set(), cands = [], g = G().gast(jd), PL = places();
      for (const [code, angle] of pairs) {
        const k = code + angle;
        if (seen.has(k) || !n.bodies.includes(code)) continue;
        seen.add(k);
        const [ra, dec] = G().bodyEqu(jd, code, method);
        const where = angle === "MC" ? G().mcLon(ra, g) : angle === "IC" ? G().icLon(ra, g) : null;
        const cities = [];
        for (const grp of ["th", "intl"]) for (const p of PL[grp]) { const km = G().distanceKm(p.lat, p.lon, angle, ra, dec, g); if (km !== null) cities.push({ name: p.name, km, far: km > orbKm }); }
        cities.sort((x, y) => x.km - y.km);
        cands.push({ body: code, angle, th: n.th[code], glyph: n.glyph[code], line_lon: where, reading: M().forReading(code, angle), cities: cities.slice(0, 5), in_orb: cities.filter((c) => !c.far).length });
      }
      cands.sort((x, y) => (x.cities.length ? x.cities[0].km : 9e9) - (y.cities.length ? y.cities[0].km : 9e9));
      step2 = { goal, goal_th: spec.th, angle: spec.angle, angle_meanings: spec.angle ? M().forLine("ANG", spec.angle).slice(0, 3) : [],
                advice, sect: sc.sect, sun_alt: sc.alt, sect_advice: M().sectAdvice(), candidates: cands,
                note: advice.some((r) => r.pairs.length) ? "ตำรามีคำแนะนำเจาะจงสำหรับเป้าหมายนี้"
                    : "ตำราไม่ได้ระบุคู่ดาว-มุมสำหรับเป้าหมายนี้ไว้ตรง ๆ — ด้านล่างเลือกตามมุมของเป้าหมาย และดาวที่ตำราแนะนำให้ผู้เริ่มต้นดูก่อน" };
    }
    // ── ข้อ 3 ──
    let step3 = null, step4 = null, step5 = null, step6 = null, clat, clon;
    if (body.city && typeof body.city === "object" && !Array.isArray(body.city)) {
      clat = num(body.city, "lat", -89.5, 89.5, "ละติจูดของเมือง"); clon = num(body.city, "lon", -180, 180, "ลองจิจูดของเมือง");
      const [rows, weak] = keptLines(lines, clat, clon);
      step3 = { city: { name: String(body.city.name === undefined ? "เมืองที่เลือก" : body.city.name), lat: clat, lon: clon },
                full_mi: FULL_MI, mid_mi: MID_MI, kept: rows, weak,
                rules: M().orbRules().filter((r) => r.value.includes("ไมล์")).slice(0, 6),
                no_reading: rows.filter((r) => !r.reading).map((r) => `${r.th} ${r.angle}`) };
      // ── ข้อ 4 ──
      const pn = RD().mapParansNear(clat, RD().mapParans(jd, n.bodies, method), PARAN_ORB_DEG).map((pr) => {
        const ms = M().forParan(pr.a, pr.b);
        return { ...pr, a_th: n.th[pr.a], b_th: n.th[pr.b], a_glyph: n.glyph[pr.a], b_glyph: n.glyph[pr.b], km: pr.dlat * G().KM_PER_DEG, mi: pr.dlat * G().KM_PER_DEG / MI, meanings: ms };
      });
      const pm = M().data().paran_meanings;
      step4 = { city: step3.city, orb_deg: PARAN_ORB_DEG, parans: pn, n_with_teaching: pn.filter((x) => x.meanings.length).length,
                rules: M().orbRules().filter((r) => (r.what + r.value).toLowerCase().includes("paran")).slice(0, 8),
                taught_pairs: [...new Set(pm.map((x) => x.pair.join(" ")))].sort().map((k) => k.split(" ")) };
      // ── ข้อ 5 ──
      step5 = relocStep5(jd, b, step3.city, clat, clon);
      // ── ข้อ 6 ──
      if (body.date_from && body.date_to) {
        const { jdA, from, to, days } = rangeOf(body), kinds6 = kindsOf(body, ["transit"]);
        step6 = { city: step3.city, date_from: from, date_to: to, days, kinds: kinds6, orb_km: orbKm,
                  ...T().timing(jd, clat, clon, method, orbKm, jdA, days, kinds6, rows, enrich, n, M().timingRules()) };
      }
    }
    // ── เมืองที่ควรไปในช่วงจร ──
    let whenWhere = null;
    if (body.date_from && body.date_to) whenWhere = whenWhereCalc(jd, method, orbKm, body);
    const step1 = { birth: { date: `${String(b.y).padStart(4, "0")}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")}`, time: b.hour_txt, tz: b.tz, lat: b.lat, lon: b.lon,
                             place: String(body.birth_place || "เมืองเกิด") }, orb_km: orbKm, near, nearest: far };
    return { method, condition: conditionApi(jd, b.lat, b.lon), step1, step2, step3, step4, step5, step6, when_where: whenWhere, goals };
  }

  function conditionApi(jd, lat, lon) {
    const c = RD().natalCondition(jd, lat, lon), n = N();
    for (const r of c.rows) { r.th = n.th[r.code]; r.glyph = n.glyph[r.code]; r.txt = deg(r.lon); for (const a of r.aspects) { a.other_th = n.th[a.other]; a.other_glyph = n.glyph[a.other]; } }
    const { sun_alt, ...rest } = c;
    return { ...rest, asc_txt: deg(c.asc), mc_txt: deg(c.mc), sect_advice: M().sectAdvice(),
             rules_note: "กฎการดู 4 ข้อมาจากคำสอนของ Helena Woods (ดูดวงกำเนิดก่อนเสมอ): ราศีที่ได้/เสียเกณฑ์ · มุมกระชับที่มากระทบ · ดาวอยู่เรือนไหน · ดาวเป็นเจ้าเรือนไหน — ตัวเลขทุกตัวคำนวณจาก engine ระบบไม่ได้ตีความให้",
             system_note: `เกณฑ์และเจ้าราศีเป็นแบบตะวันตก/เฮลเลนิสติก (จักรราศีสายนิรายนะไม่ได้ใช้) · เรือนแบบราศีเต็ม · orb ของมุม ${RD().ASPECT_ORB_NATAL.toFixed(1)}° เป็นค่าตั้งของระบบ ไม่ใช่ตัวเลขจากตำราที่รวบรวมไว้ (สกิลเก็บ orb ของเส้นบนแผนที่เป็นไมล์ ไม่ได้ระบุ orb ของมุมในดวง)` };
  }

  function relocStep5(jd, b, cityInfo, clat, clon) {
    const n = N();
    const rel = RD().relocatedUranian(jd, b.lat, b.lon, clat, clon);
    const rowsN = rel.houses_natal, rowsC = rel.houses_city, houses = [];
    for (let i = 0; i < 12; i++) {
      const hn = rowsN[i], hc = rowsC[i];
      houses.push({ house: hn.house, theme: hn.theme, natal: hn.factors, city: hc.factors,
                    moved_in: hc.factors.filter((c) => !hn.factors.includes(c)), moved_out: hn.factors.filter((c) => !hc.factors.includes(c)) });
    }
    const mv = {}; for (const m of rel.house_moves) mv[m.factor] = m;
    const essence = (t) => { if (!t) return null; const h = t.split("จุดแข็ง")[0].replace(/^[ ·]+|[ ·]+$/g, ""); return h || t; };
    const gained = [], faded = [];
    for (const h of houses) {
      if (h.moved_in.length) gained.push({ house: h.house, theme: h.theme, factors: h.moved_in.map((c) => ({ code: c, th: RTH[c], meaning: essence((mv[c] || {}).meaning_city_house), from_house: (mv[c] || {}).natal_house })) });
      if (h.moved_out.length) faded.push({ house: h.house, theme: h.theme, factors: h.moved_out.map((c) => ({ code: c, th: RTH[c], to_house: (mv[c] || {}).city_house })) });
    }
    // เรียงตามจำนวนปัจจัย มากไปน้อย (Python sort เสถียร → ผูกกันคงลำดับเรือน)
    gained.sort((x, y) => y.factors.length - x.factors.length); faded.sort((x, y) => y.factors.length - x.factors.length);
    const sh = (ax) => rel.axes[ax].shift, fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
    const summary = {
      headline: `ย้ายไป${cityInfo.name} แล้ว MC เลื่อน ${fmt(sh("MC"))}° และลัคนาเลื่อน ${fmt(sh("AS"))}° → ปัจจัย ${rel.house_moves.length} ตัวเปลี่ยนเรือน · ภาพดาวกับ MC/AS เกิดใหม่ ${rel.pictures.new.length} ภาพ หายไป ${rel.pictures.lost.length} ภาพ`,
      gained: gained.slice(0, 4), faded: faded.slice(0, 4), n_gained_houses: gained.length, n_faded_houses: faded.length,
      pictures_new: rel.pictures.new.filter((p) => p.meaning).slice(0, 4), pictures_lost: rel.pictures.lost.filter((p) => p.meaning).slice(0, 4),
      no_reading: rel.house_moves.filter((m) => !m.meaning_city_house).map((m) => `${RTH[m.factor]} (เรือน ${m.city_house})`),
      source_note: "ธีมเรือนและคำอ่านดาวในเรือนมาจากพจนานุกรม AISTRO · ภาพดาวใช้คำแปลจากพจนานุกรมเดียวกัน · ส่วนที่ไม่มีในพจนานุกรมจะบอกว่าไม่มี ไม่เติมเอง",
    };
    const k = RD().relocatedClassic(jd, b.lat, b.lon, clat, clon);
    const classic = { natal_asc_txt: deg(k.natal_asc), city_asc_txt: deg(k.city_asc), natal_asc_sign: SIGNS[RD().signIndex(k.natal_asc)], city_asc_sign: SIGNS[RD().signIndex(k.city_asc)],
                      natal_mc_txt: deg(k.natal_mc), city_mc_txt: deg(k.city_mc),
                      rows: k.rows.map((r) => ({ code: r.code, th: n.th[r.code], glyph: n.glyph[r.code], txt: deg(r.lon), sign_th: r.sign_th, natal_house: r.natal_house, city_house: r.city_house, moved: r.moved, city_weight: r.city_weight, natal_weight: r.natal_weight })),
                      n_moved: k.n_moved,
                      asc_ruler: { code: k.asc_ruler.code, th: n.th[k.asc_ruler.code], glyph: n.glyph[k.asc_ruler.code], txt: deg(rel.natal_positions[k.asc_ruler.code] !== undefined ? RD().natalLons(jd)[k.asc_ruler.code] : 0),
                                   sign_th: k.asc_ruler.sign_th, house: k.asc_ruler.house, dignity: k.asc_ruler.dignity, weight: k.asc_ruler.weight },
                      note: "เรือนแบบราศีเต็ม (whole sign) ตามสายที่คำสอนใช้ · ดาวไม่ขยับ ราศีเท่าเดิม ที่เปลี่ยนคือลัคนา/MC จึงทำให้เรือนเลื่อน — คนละระบบกับเรือนยูเรเนียนในหัวข้อถัดไป",
                      ruler_note: "แหล่ง Moses Siregar แนะนำให้ดูเจ้าเรือนลัคนาของดวงย้ายเมืองเป็นตัวชี้หลัก ว่าการอยู่ที่นั่นจะเป็นอย่างไร — ระบบแสดงตำแหน่งให้ ไม่ได้ตีความแทน" };
    const B = methodB(rel.natal_positions, jd, b, clat, clon);
    return { summary, city: cityInfo, classic,
             axes: Object.fromEntries(["MC", "AS"].map((ax) => [ax, { ...rel.axes[ax], natal_txt: deg(rel.axes[ax].natal), city_txt: deg(rel.axes[ax].city) }])),
             positions: A().CODE_ORDER.filter((c) => c in rel.natal_positions).map((c) => ({ code: c, th: RTH[c], lon: rel.natal_positions[c], txt: deg(rel.natal_positions[c]), city_lon: rel.positions[c], city_txt: (c === "MC" || c === "AS") ? deg(rel.positions[c]) : null })),
             houses, house_moves: rel.house_moves.map((m) => ({ ...m, th: RTH[m.factor] })),
             pictures_new: rel.pictures.new, pictures_lost: rel.pictures.lost,
             B: { points: B.points, natal_vs_point: B.natal_vs_point, note: B.meaning_note },
             note: "แสดงวิธี A (ย้ายดวง: เวลาเกิดเดิม MC/AS ของเมืองใหม่) · เรือนยูเรเนียนแกน (AR+MC)/2 · ธีมเรือนและคำอ่านดาวในเรือนมาจากพจนานุกรม AISTRO ไม่ใช่คำสอนแผนที่ดวง" };
  }

  // ── วิธี B: LM/LA ประจำเมือง (พอร์ตจาก aistro.local_meridian / local_ascendant) ──
  const SOLAR_PER_SIDEREAL = 0.99726957, EPS_FIXED = 23.4392911;
  const D2R = Math.PI / 180;
  function anglesFromArmc(armc, lat, eps) {      // สูตรปิดเดียวกับ AISTRO.anglesAt แต่รับ ARMC/ε ตรง ๆ
    const ar = armc * D2R, er = eps * D2R, fr = lat * D2R;
    const mc = mod360(Math.atan2(Math.sin(ar), Math.cos(ar) * Math.cos(er)) / D2R);
    const asc = mod360(Math.atan2(Math.cos(ar), -(Math.sin(ar) * Math.cos(er) + Math.tan(fr) * Math.sin(er))) / D2R);
    return { asc, mc };
  }
  const localMeridian = (lon) => mod360(lon * SOLAR_PER_SIDEREAL + 0.0012);
  function localAscendant(lat, lon) {
    const lm = localMeridian(lon); let armc = lm;
    for (let i = 0; i < 60; i++) {
      const d = wrap180(anglesFromArmc(armc, lat, EPS_FIXED).mc - lm);
      armc -= d * 0.9;
      if (Math.abs(d) < 1e-10) break;
    }
    return anglesFromArmc(mod360(armc), lat, EPS_FIXED).asc;
  }
  /** ปัจจัยเดี่ยว+ศูนย์รังสีที่ทำมุมกับแกน (aistro.axis_aspects ชั้น r) — ผ่าน AISTRO.axisPictures ที่สอบเทียบแล้ว */
  function axisContacts(positions, axisValue, axisLabel) {
    const layers = { r: { ...positions } };
    let ax;
    if (axisLabel) ax = A().axisPictures(layers, axisLabel, "r", { orbA: 1.0, orbAB: 1.0, layersA: ["r"], layersAB: ["r"] });
    else { layers.r.__AX = axisValue; ax = A().axisPictures(layers, "__AX", "r", { orbA: 1.0, orbAB: 1.0, layersA: ["r"], layersAB: ["r"] }); }
    return ax;
  }
  function methodB(natal, jd, b, clat, clon) {
    const pts = { LM: localMeridian(clon), LA: localAscendant(clat, clon) };
    return { points: pts,
             natal_vs_point: { MC_vs_LM: wrap180(natal.MC - pts.LM), AS_vs_LA: wrap180(natal.AS - pts.LA) },
             contacts: { LM: axisContacts(natal, pts.LM, null), LA: axisContacts(natal, pts.LA, null) },
             meaning_note: "ไม่มีคำแปล: พจนานุกรม AISTRO ไม่มีคีย์ LM/LA และยังไม่มีตำราวิธีอ่านในมือ" };
  }
  const ORB_22_5_TAUGHT = 0.5;
  function singlesView(ax, axisCode, withMeaning) {
    // R.singles: ปัจจัยเดี่ยว (ไม่ใช่ A/B) เรียง orb · ตัด __AX ที่เป็นแกนสมมติออก
    return ax.A.filter((x) => x.p !== "__AX").slice().sort((x, y) => x.orb - y.orb).map((x) => {
      const m = withMeaning ? (A().lookupMeaning({ type: "A", p: x.p, axis: axisCode }, "person").text || null) : null;
      return { code: x.p, th: RTH[x.p], angle: x.ang, orb: x.orb, over_taught_orb: x.ang === 22.5 && x.orb > ORB_22_5_TAUGHT,
               key: withMeaning ? A().dictKey2(x.p, axisCode) : null, meaning: m };
    });
  }
  // ── /api/city ────────────────────────────────────────────────────────────
  function city(body) {
    const b = parseBirth(body), c = cityOf(body.city), method = methodOf(body), orbKm = orbOf(body), jd = jdOf(b), n = N();
    const lines = G().lineSet(jd, jd, n.line_bodies, method);
    const near = G().linesNear(c.lat, c.lon, lines, orbKm).map((h) => ({ ...h, th: n.th[h.body], glyph: n.glyph[h.body], group: n.group[h.body],
      meanings: M().forLine(h.body, h.angle), angle_meanings: M().forLine("ANG", h.angle), astrocom: M().acLine(h.body, h.angle),
      reading: M().forMerged(h.body, h.angle), text_reading: M().forReading(h.body, h.angle), tnp: M().tnpLineReading(h.body, h.angle) }));
    const parans = RD().mapParansNear(c.lat, RD().mapParans(jd, n.bodies, method), 1.0).map((p) => ({ ...p, a_th: n.th[p.a], b_th: n.th[p.b], meanings: M().forParan(p.a, p.b) }));
    const rel = RD().relocatedUranian(jd, b.lat, b.lon, c.lat, c.lon);
    const natal = rel.natal_positions, reloc = rel.positions;
    const singles = {}, singlesBirth = {};
    for (const ax of ["MC", "AS"]) {
      singles[ax] = singlesView(axisContacts(reloc, reloc[ax], ax), ax, true);
      singlesBirth[ax] = singlesView(axisContacts(natal, natal[ax], ax), ax, false).map((r) => r.code);
    }
    const B = methodB(natal, jd, b, c.lat, c.lon);
    const relView = { A: { axes: rel.axes, singles, singles_birthplace: singlesBirth, pictures_new: rel.pictures.new, pictures_lost: rel.pictures.lost, house_moves: rel.house_moves },
                      B: { points: B.points, natal_vs_point: B.natal_vs_point, singles: { LM: singlesView(B.contacts.LM, "LM", false), LA: singlesView(B.contacts.LA, "LA", false) }, note: B.meaning_note } };
    const acOrder = Object.values(M().data().ac_code);
    const crossings = [], seen = new Set();
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const h1 = near[i], h2 = near[j];
      if (h1.body === h2.body) continue;
      const x = M().acCrossing(h1.body, h2.body);
      if (!x) continue;
      const [a, bb] = acOrder.indexOf(h1.body) <= acOrder.indexOf(h2.body) ? [h1, h2] : [h2, h1];
      const pair = a.body + "|" + bb.body;
      if (seen.has(pair)) continue;
      seen.add(pair);
      crossings.push({ a: a.body, b: bb.body, a_th: n.th[a.body], b_th: n.th[bb.body], a_angle: a.angle, b_angle: bb.angle, km: Math.max(h1.km, h2.km), astrocom: x });
    }
    const dyn = {}, kindsC = kindsOf(body);
    if (kindsC.length && body.date_on) {
      const [jdOn] = parseDate(body.date_on, "วันที่ดูจร");
      for (const kind of kindsC) {
        const sets = kind === "transit" ? G().transitLines(jd, jdOn, n.bodies, method) : G().progressedLines(jd, jdOn, n.bodies, method);
        dyn[kind] = G().linesNear(c.lat, c.lon, sets, orbKm).map((h) => ({ ...h, th: n.th[h.body], glyph: n.glyph[h.body] }));
      }
    }
    return { city: c, lines_near: near, parans_near: parans, crossings, dynamic_near: dyn, relocation: relView, orb_km: orbKm, method };
  }

  // ── เมืองที่ควรไปในช่วงจร แยกตามหมวด (when_where) ───────────────────────────
  function whenWhereCalc(jd, method, orbKm, body) {
    const n = N(), { jdA, from, to, days } = rangeOf(body), kinds = kindsOf(body, ["transit"]), goals = M().goals(), PL = places();
    const cats = {};
    for (const gk in goals) {
      const spec = goals[gk], adv = M().adviceFor(gk);
      let pairs = adv.flatMap((r) => r.pairs.map((p) => [p[0], p[1]]));
      if (!pairs.length) {
        const planets = [...new Set(adv.flatMap((r) => r.planets))]; const pl = planets.length ? planets : ["SU", "VE", "JU"];
        const angs = spec.angle ? [spec.angle] : G().ANGLES.slice();
        pairs = pl.flatMap((c) => angs.map((a) => [c, a]));
      }
      const seenP = new Set(); pairs = pairs.filter(([c, a]) => { const k = c + a; if (seenP.has(k) || !n.bodies.includes(c)) return false; seenP.add(k); return true; });
      const spots = {}, order = [];
      for (const [code, angle] of pairs) {
        const [ra, dec] = G().bodyEqu(jd, code, method), g = G().gast(jd);
        for (const grp of ["th", "intl"]) for (const p of PL[grp]) {
          const km = G().distanceKm(p.lat, p.lon, angle, ra, dec, g);
          if (km !== null && km <= orbKm) {
            const key = p.name + "|" + code + "|" + angle;
            if (!(key in spots)) order.push(key);
            spots[key] = { city: p.name, lat: p.lat, lon: p.lon, body: code, angle, th: n.th[code], glyph: n.glyph[code], km, reading: M().forReading(code, angle), windows: [] };
          }
        }
      }
      for (const kind of kinds) {
        const step = T().STEP[kind], runs = {}, done = [], ts = T().sampleTimes(jdA, days, step);
        for (let i = 0; i < ts.length; i++) {
          const sets = kind === "transit" ? G().transitLines(jd, ts[i], n.bodies, method) : G().progressedLines(jd, ts[i], n.bodies, method);
          for (const key of order) {
            const sp = spots[key], v = sets[sp.body];
            for (const ang of G().ANGLES) {
              const km = G().distanceKm(sp.lat, sp.lon, ang, v.ra, v.dec, v.gast);
              if (km === null || km > orbKm) continue;
              const rk = key + "|" + kind + "|" + ang, cur = runs[rk];
              if (cur && cur.last_i === i - 1) { cur.last_i = i; cur.n++; if (km < cur.km) { cur.km = km; cur.peak = ts[i]; } }
              else { if (cur) done.push([rk, cur]); runs[rk] = { first_i: i, last_i: i, n: 1, km, peak: ts[i] }; }
            }
          }
        }
        for (const rk in runs) done.push([rk, runs[rk]]);
        for (const [rk, r] of done) {
          const parts = rk.split("|"), key = parts.slice(0, 3).join("|"), kd = parts[3], ang = parts[4], sp = spots[key];
          const kmAt = T().lineKmAt(jd, kd, sp.body, ang, sp.lat, sp.lon, method);
          const [tIn, tOut] = T().edges(r, ts, (t) => kmAt(t) <= orbKm);
          const [pk, km] = T().refineMin(kmAt, Math.max(tIn, r.peak - step), Math.min(tOut, r.peak + step));
          sp.windows.push({ kind: kd, angle: ang, from: T().ymd(tIn), to: T().ymd(tOut), jd_in: tIn, jd_out: tOut, closest_date: T().ymd(pk), closest_km: km, hours: Math.round((tOut - tIn) * 24 * 10) / 10 });
        }
      }
      const aspCache = {};
      for (const key of order) {
        const sp = spots[key]; sp.aspects = sp.aspects || [];
        for (const kind of kinds) { const ck = sp.body + "|" + kind; if (!(ck in aspCache)) aspCache[ck] = T().aspectWindows(jd, jdA, days, sp.body, kind); sp.aspects.push(...aspCache[ck]); }
        sp.best = []; for (const w of sp.windows) for (const a of sp.aspects) if (T().overlap(w, a)) sp.best.push({ line: w, aspect: a });
      }
      const rows = order.map((k) => spots[k]).sort((x, y) => (x.best.length ? 0 : 1) - (y.best.length ? 0 : 1) || (x.windows.length ? 0 : 1) - (y.windows.length ? 0 : 1) || x.km - y.km);
      cats[gk] = { th: spec.th, angle: spec.angle, advice: adv, pairs: pairs.map((p) => [p[0], p[1]]), spots: rows.slice(0, 12),
                   n_with_window: rows.filter((x) => x.windows.length).length, n_with_best: rows.filter((x) => x.best.length).length };
    }
    return { date_from: from, date_to: to, days, kinds, orb_km: orbKm, aspect_orb: T().ASPECT_ORB, categories: cats,
             timing_advice: M().timingRules().filter((x) => x.cites && x.cites.length).slice(0, 4) };
  }

  /** ตัวแทน post(url, body) ของหน้าเว็บ — คืน Promise เหมือน fetch เพื่อให้โค้ด UI เดิมใช้ต่อได้ */
  async function call(url, body) {
    const fn = { "/api/chart": chart, "/api/dynamic": dynamic, "/api/window": windowApi, "/api/reading": reading, "/api/city": city }[url];
    if (!fn) throw new Error("ไม่รู้จัก " + url);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadInput("ตัวคำขอต้องเป็น JSON object");
    try { return fn(body); }
    // RangeError มาได้ 2 ทาง: ละติจูดเหนือวงอาร์กติก (reading.assertHousable) และวันที่นอกช่วงตารางดาว (engine.js 1900–2099)
    // เดิมใส่คำว่า "ใกล้ขั้วโลกเกินไป" ให้ทั้งสองแบบ — ผู้ใช้ที่กรอกปี 1879 จึงได้เหตุผลผิด (เจอจริง 21 ก.ย. 2026)
    catch (e) {
      if (e instanceof RangeError) {
        throw new BadInput(/อาร์กติก|ขั้วโลก/.test(e.message)
          ? "คำนวณไม่ได้ที่พิกัดนี้ (ใกล้ขั้วโลกเกินไปสำหรับระบบเรือน): " + e.message
          : "คำนวณไม่ได้: " + e.message);
      }
      throw e;
    }
  }

  root.API = { call, chart, dynamic, window: windowApi, reading, city, places, deg, BadInput, parseBirth, parseDate,
               localMeridian, localAscendant, anglesFromArmc, RTH, MI, FULL_MI, MID_MI };
})(typeof globalThis !== "undefined" ? globalThis : this);
