/* reading.js — ขั้นที่ 2 ของเวอร์ชันมือถือ: paran · สภาพดาวในดวงกำเนิด · ดวงย้ายเมือง (เรือนปกติ + ยูเรเนียน)
 *
 * พอร์ตจาก acg/parans.py · acg/natal.py · ui/server.py (natal_condition, relocated_classic)
 * และ relocation/uranian.py (method_a, house_rows) — ต้องให้ผลตรงกับ Python ทุกค่า (ตรวจใน selftest.html)
 *
 * ใช้ของที่มีอยู่แล้วใน engine.js ของแอปผ่าน global AISTRO:
 *   chartAt(jd, lat, lon)          ตำแหน่ง 22 ปัจจัยรหัส AISTRO (ราหู = true node)
 *   anglesAt(jd, lat, lon)         ลัคนา/MC — พิสูจน์ตรง swe.houses 0.000000″
 *   uranianHouses / houseOf        เรือนยูเรเนียนแกน (AR+MC)/2
 *   clusterOnDial(pos, 22.5, 1.2)  กลุ่มดาวบนจาน (กฎลูกโซ่ของ AISTRO)
 *   lookupMeaning / houseMeaning   พจนานุกรม AISTRO (ภาพดาว 2 ปัจจัย · ดาวในเรือน)
 */
(function (root) {
  "use strict";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const mod360 = (v) => ((v % 360) + 360) % 360;
  const wrap180 = (v) => ((v + 180) % 360 + 360) % 360 - 180;
  const ANGLES = ["MC", "IC", "AC", "DC"];

  // ── 1) paran บนแผนที่ (พอร์ตตรงจาก acg/parans.py) ─────────────────────────
  /** H₀ (องศา) — null ถ้าดาวไม่ขึ้น-ตกที่ละติจูดนี้ */
  function semiArc(dec, lat) {
    const c = -Math.tan(lat * D2R) * Math.tan(dec * D2R);
    if (c < -1 || c > 1) return null;
    return Math.acos(c) * R2D;
  }
  /** เวลาดาราคติท้องถิ่น (องศา) ที่ดาวอยู่บนแกนนั้น ณ ละติจูด lat */
  function lstOnAngle(ang, ra, dec, lat) {
    if (ang === "MC") return mod360(ra);
    if (ang === "IC") return mod360(ra + 180);
    const h = semiArc(dec, lat);
    if (h === null) return null;
    return ang === "AC" ? mod360(ra - h) : mod360(ra + h);
  }
  function solve(f, a, b) {
    let fa = f(a);
    for (let i = 0; i < 80; i++) {
      const m = (a + b) / 2, fm = f(m);
      if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  }
  /** ละติจูดทั้งหมดที่ดาว 1 บนแกน ang1 พร้อมดาว 2 บนแกน ang2 (เรียงใต้→เหนือ) */
  function paranLatitudes(ra1, dec1, ang1, ra2, dec2, ang2, step) {
    step = step || 0.5;
    const isM = (a) => a === "MC" || a === "IC";
    if (isM(ang1) && isM(ang2)) return [];
    if (isM(ang1) || isM(ang2)) {
      // สูตรปิด: ดาวเมริเดียน M กับดาวขอบฟ้า H → H₀ ของ H ต้องเท่ากับระยะ RA ที่กำหนด
      let raM, angM, raH, decH, angH;
      if (isM(ang1)) { raM = ra1; angM = ang1; raH = ra2; decH = dec2; angH = ang2; }
      else { raM = ra2; angM = ang2; raH = ra1; decH = dec1; angH = ang1; }
      const lst = angM === "MC" ? raM : raM + 180;
      const h0 = angH === "AC" ? wrap180(raH - lst) : wrap180(lst - raH);
      if (!(h0 >= 0 && h0 <= 180) || Math.abs(Math.tan(decH * D2R)) < 1e-15) return [];
      return [Math.atan(-Math.cos(h0 * D2R) / Math.tan(decH * D2R)) * R2D];
    }
    let lim = 89.999;
    for (const [ang, dec] of [[ang1, dec1], [ang2, dec2]]) {
      if (ang === "AC" || ang === "DC") lim = Math.min(lim, 90 - Math.abs(dec) - 1e-9);
    }
    const f = (lat) => wrap180(lstOnAngle(ang1, ra1, dec1, lat) - lstOnAngle(ang2, ra2, dec2, lat));
    const out = [];
    const n = Math.floor(2 * lim / step);
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(-lim + i * (2 * lim / n));
    let prevX = xs[0], prevF = f(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i], fx = f(x);
      // เครื่องหมายเปลี่ยนจริง (ไม่ใช่กระโดดข้าม ±180)
      if (fx === 0 || ((fx < 0) !== (prevF < 0) && Math.abs(fx - prevF) < 90)) {
        out.push(fx === 0 ? x : solve(f, prevX, x));
      }
      prevX = x; prevF = fx;
    }
    return out;
  }
  /** paran ทุกคู่ดาว × ทุกคู่แกน — [{a, ang_a, b, ang_b, lat}] เรียงตาม (lat, a, b) */
  function mapParans(jd, codes, method) {
    const eq = {};
    for (const c of codes) eq[c] = root.ACG.bodyEqu(jd, c, method || "mundo");
    const out = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const a = codes[i], b = codes[j];
        for (const ang1 of ANGLES) for (const ang2 of ANGLES) {
          for (const lat of paranLatitudes(eq[a][0], eq[a][1], ang1, eq[b][0], eq[b][1], ang2)) {
            out.push({ a, ang_a: ang1, b, ang_b: ang2, lat });
          }
        }
      }
    }
    // paran ที่ละติจูดขอบ (90−|δ|−1e-9) หลายคู่ได้ค่าเท่ากันถึง ~1e-11 — ทั้งสองเอนจินคืนคู่เดียวกันแต่เศษต่างกัน
    // จึงเรียงด้วยค่าปัด 1e-8 (เฉพาะการเรียง ค่าที่ส่งออกไม่แตะ) ให้ลำดับตรง Python ที่มักได้ค่าเท่ากันเป๊ะ
    const r8 = (v) => Math.round(v * 1e8) / 1e8;
    return out.sort((p, q) => r8(p.lat) - r8(q.lat) || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
  }
  function mapParansNear(lat, parans, orbDeg) {
    orbDeg = orbDeg === undefined ? 1.0 : orbDeg;
    return parans.filter((p) => Math.abs(p.lat - lat) <= orbDeg)
      .map((p) => ({ ...p, dlat: Math.abs(p.lat - lat) }))
      .sort((p, q) => p.dlat - q.dlat);
  }

  // ── 2) สภาพดาวในดวงกำเนิด (พอร์ตตรงจาก acg/natal.py) ─────────────────────
  const SIGNS_TH = ["เมษ", "พฤษภ", "เมถุน", "กรกฎ", "สิงห์", "กันย์", "ตุลย์", "พิจิก", "ธนู", "มังกร", "กุมภ์", "มีน"];
  // ตารางเกณฑ์คลาสสิก 7 ดวง — ดัชนีราศี 0 = เมษ · ดาวชั้นนอกไม่มีเกณฑ์ (คืน [] ไม่เดา)
  const DIGNITY = {
    SU: { "เกษตร": [4], "อุจ": [0], "ประ": [10], "นิจ": [6] },
    MO: { "เกษตร": [3], "อุจ": [1], "ประ": [9], "นิจ": [7] },
    ME: { "เกษตร": [2, 5], "อุจ": [5], "ประ": [8, 11], "นิจ": [11] },
    VE: { "เกษตร": [1, 6], "อุจ": [11], "ประ": [0, 7], "นิจ": [5] },
    MA: { "เกษตร": [0, 7], "อุจ": [9], "ประ": [1, 6], "นิจ": [3] },
    JU: { "เกษตร": [8, 11], "อุจ": [3], "ประ": [2, 5], "นิจ": [9] },
    SA: { "เกษตร": [9, 10], "อุจ": [6], "ประ": [3, 4], "นิจ": [0] },
  };
  const DIGNITY_NOTE = { "เกษตร": "อยู่ราศีของตัวเอง — ทำงานได้เต็มที่ตามธรรมชาติของดาว",
                         "อุจ": "ได้ราศีอุจ — แสดงออกได้เด่นเป็นพิเศษ",
                         "ประ": "อยู่ราศีตรงข้ามเกษตร — อึดอัด ทำงานได้ไม่ถนัด",
                         "นิจ": "อยู่ราศีตรงข้ามอุจ — อ่อนแรง ต้องออกแรงมากกว่าปกติ" };
  const SIGN_RULER = ["MA", "VE", "ME", "MO", "SU", "ME", "VE", "MA", "JU", "SA", "SA", "JU"];
  const HOUSE_WEIGHT = { 5: "เบา", 9: "เบา", 11: "เบา", 6: "หนัก", 8: "หนัก", 12: "หนัก" };
  const ASPECTS_TH = { 0: "ร่วม", 60: "โยค", 90: "จัตุรัส", 120: "ตรีโกณ", 180: "ตรงข้าม" };
  const ASPECT_KIND = { 90: "หนัก", 180: "หนัก", 120: "ช่วย", 60: "ช่วย", 0: "ร่วม" };
  const ASPECT_ORB_NATAL = 6.0;       // ค่าตั้งของระบบ (ตำราที่รวบรวมไม่ได้ระบุ orb ของมุมในดวง) — ตรง acg/natal.py
  const SECT_ROLE = { day: { JU: "ดาวที่เป็นคุณที่สุดสำหรับดวงนี้", MA: "ดาวที่หนักที่สุดสำหรับดวงนี้" },
                      night: { VE: "ดาวที่เป็นคุณที่สุดสำหรับดวงนี้", SA: "ดาวที่หนักที่สุดสำหรับดวงนี้" } };
  // ดาวที่ตรวจสภาพ — ตรง NATAL_BODIES ของ ui/server.py (ราหูเฉลี่ย)
  const NATAL_BODIES = ["SU", "MO", "ME", "VE", "MA", "JU", "SA", "UR", "NE", "PL", "MN"];

  const signIndex = (lon) => Math.floor(mod360(lon) / 30);
  const degInSign = (lon) => mod360(lon) - signIndex(lon) * 30;
  function dignityOf(code, lon) {
    const tab = DIGNITY[code];
    if (!tab) return [];
    const s = signIndex(lon);
    return ["เกษตร", "อุจ", "ประ", "นิจ"].filter((k) => tab[k].includes(s));
  }
  const wholeSignHouse = (lon, asc) => ((signIndex(lon) - signIndex(asc)) % 12 + 12) % 12 + 1;
  function rulesHouses(code, asc) {
    const out = [];
    for (let i = 0; i < 12; i++) if (SIGN_RULER[(signIndex(asc) + i) % 12] === code) out.push(i + 1);
    return out;
  }
  function aspectsTo(code, positions, orb) {
    orb = orb === undefined ? ASPECT_ORB_NATAL : orb;
    const me = positions[code], out = [];
    for (const other in positions) {
      if (other === code) continue;
      const d = Math.abs(wrap180(positions[other] - me));
      for (const asp of [0, 60, 90, 120, 180]) {
        const off = Math.abs(d - asp);
        if (off <= orb) {
          out.push({ other, aspect: asp, aspect_th: ASPECTS_TH[asp],
                     orb: Math.round(off * 100) / 100, kind: ASPECT_KIND[asp] });
          break;
        }
      }
    }
    return out.sort((a, b) => a.orb - b.orb);
  }
  /** ดวงกลางวัน/กลางคืน — อาทิตย์เหนือขอบฟ้าจริง (ความสูงเรขาคณิต ไม่หักเหแสง เหมือน swe.azalt ค่าที่ [1]) */
  function sectOf(jd, lat, lon) {
    const [ra, dec] = root.ACG.bodyEqu(jd, "SU", "mundo");
    const H = (root.ACG.gast(jd) + lon - ra) * D2R;
    const alt = Math.asin(Math.sin(lat * D2R) * Math.sin(dec * D2R) + Math.cos(lat * D2R) * Math.cos(dec * D2R) * Math.cos(H)) * R2D;
    return { sect: alt > 0 ? "day" : "night", alt };
  }
  // ระบบเรือน Placidus นิยามไม่ได้เหนือวงอาร์กติก — ฝั่ง PC swe.houses โยน error แล้วตอบ 400
  // anglesAt ของ engine.js เป็นสูตรปิดจึงคืนตัวเลขออกมาได้แม้ไร้ความหมาย ต้องกันเองไม่ให้คำนวณเงียบ ๆ
  const POLAR_LIMIT = 66.0;
  function assertHousable(lat, what) {
    if (Math.abs(lat) > POLAR_LIMIT) {
      throw new RangeError(`${what} ละติจูด ${lat}° อยู่เหนือวงอาร์กติก — ลัคนา/ระบบเรือนนิยามไม่ได้ (เหมือนที่เวอร์ชัน PC ปฏิเสธ)`);
    }
  }
  const natalLons = (jd) => Object.fromEntries(NATAL_BODIES.map((c) => [c, root.AISTRO.calc(root.ACG.LON_ALIAS[c] || c, jd)]));

  /** ข้อ 1 ของการอ่าน — ข้อเท็จจริงล้วน ตรง server.natal_condition */
  function natalCondition(jd, lat, lon, orb) {
    orb = orb === undefined ? ASPECT_ORB_NATAL : orb;
    assertHousable(lat, "ที่เกิด");
    const ang = root.AISTRO.anglesAt(jd, lat, lon);
    const asc = ang.asc, mc = ang.mc, pos = natalLons(jd);
    const sc = sectOf(jd, lat, lon);
    const rows = [];
    for (const code of NATAL_BODIES) {
      const plon = pos[code], dg = dignityOf(code, plon), h = wholeSignHouse(plon, asc);
      rows.push({ code, lon: plon, sign: signIndex(plon), sign_th: SIGNS_TH[signIndex(plon)],
                  deg_in_sign: Math.round(degInSign(plon) * 100) / 100,
                  dignity: dg, dignity_note: dg.map((x) => DIGNITY_NOTE[x]), has_dignity_table: code in DIGNITY,
                  house: h, house_weight: HOUSE_WEIGHT[h] || null, rules: rulesHouses(code, asc),
                  aspects: aspectsTo(code, pos, orb), sect_role: SECT_ROLE[sc.sect][code] || null });
    }
    return { sect: sc.sect, sun_alt: sc.alt, asc, mc, asc_sign_th: SIGNS_TH[signIndex(asc)],
             orb, houses: "whole", rows };
  }

  // ── 3) ดวงย้ายเมืองแบบเรือนปกติ (ราศีเต็ม) — ตรง server.relocated_classic ─────
  function relocatedClassic(jd, bLat, bLon, cLat, cLon) {
    assertHousable(bLat, "ที่เกิด"); assertHousable(cLat, "เมืองปลายทาง");
    const n = root.AISTRO.anglesAt(jd, bLat, bLon), c = root.AISTRO.anglesAt(jd, cLat, cLon);
    const pos = natalLons(jd);
    const rows = [];
    let moved = 0;
    for (const code of NATAL_BODIES) {
      const hn = wholeSignHouse(pos[code], n.asc), hc = wholeSignHouse(pos[code], c.asc);
      moved += hn !== hc ? 1 : 0;
      rows.push({ code, lon: pos[code], sign_th: SIGNS_TH[signIndex(pos[code])],
                  natal_house: hn, city_house: hc, moved: hn !== hc,
                  city_weight: HOUSE_WEIGHT[hc] || null, natal_weight: HOUSE_WEIGHT[hn] || null });
    }
    const ruler = SIGN_RULER[signIndex(c.asc)];
    const rl = rows.find((r) => r.code === ruler);
    return { natal_asc: n.asc, city_asc: c.asc, natal_mc: n.mc, city_mc: c.mc, rows, n_moved: moved,
             asc_ruler: { code: ruler, sign_th: rl.sign_th, house: rl.city_house,
                          dignity: dignityOf(ruler, pos[ruler]), weight: HOUSE_WEIGHT[rl.city_house] || null } };
  }

  // ── 4) ดวงย้ายเมืองยูเรเนียน วิธี A (พอร์ตจาก relocation/uranian.py method_a + house_rows) ──
  const PERSONAL = ["MC", "AS"];
  const DIAL = 22.5, ORB_PICTURE = 1.2;          // aistro.DIAL_DEFAULT · aistro.ORB_RR
  const houseAxis = (pos) => mod360((pos.AR + pos.MC) / 2);
  /** ภาพดาว 2 ปัจจัยที่มี MC หรือ AS — ทุกคู่ภายในกลุ่มลูกโซ่ (Cluster.pairs ของ Python) */
  function picturesWith(pos) {
    const out = new Set();
    for (const cl of root.AISTRO.clusterOnDial(pos, DIAL, ORB_PICTURE)) {
      const m = cl.members.slice().sort();
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
        if (PERSONAL.includes(m[i]) || PERSONAL.includes(m[j])) out.add(m[i] + " " + m[j]);
      }
    }
    return out;
  }
  const pairKey = (a, b) => a < b ? a + " " + b : b + " " + a;
  const pictureMeaning = (a, b) => {
    const r = root.AISTRO.lookupMeaning({ type: "A", p: a, axis: b }, "person");
    return r && r.text ? r.text : null;
  };
  /** ธีมเรือน 12 เรือน (ต้องโหลด house dict ก่อน) */
  const houseTheme = (h) => {
    const d = root.HOUSE_DICT;
    return d && d.house_theme["ดวงบุคคล"] ? (d.house_theme["ดวงบุคคล"][String(h)] || null) : null;
  };
  function houseRows(pos) {
    const houses = root.AISTRO.uranianHouses(pos, houseAxis(pos), 4);
    const out = [];
    for (let h = 1; h <= 12; h++) {
      out.push({ house: h, theme: houseTheme(h),
                 factors: root.AISTRO.CODE_ORDER.filter((c) => houses[h].includes(c) && c !== "AR") });
    }
    return out;
  }
  function relocatedUranian(jd, bLat, bLon, cLat, cLon) {
    assertHousable(bLat, "ที่เกิด"); assertHousable(cLat, "เมืองปลายทาง");
    const natal = root.AISTRO.chartAt(jd, bLat, bLon);
    const ang = root.AISTRO.anglesAt(jd, cLat, cLon);
    const reloc = { ...natal, MC: ang.mc, AS: ang.asc };
    const picN = picturesWith(natal), picR = picturesWith(reloc);
    const hn = root.AISTRO.uranianHouses(natal, houseAxis(natal), 4);
    const hr = root.AISTRO.uranianHouses(reloc, houseAxis(reloc), 4);
    const whereN = {}, whereR = {};
    for (const h in hn) for (const p of hn[h]) whereN[p] = +h;
    for (const h in hr) for (const p of hr[h]) whereR[p] = +h;
    const moves = [];
    for (const p of root.AISTRO.CODE_ORDER) {
      if (p === "AR" || whereN[p] === whereR[p]) continue;
      moves.push({ factor: p, natal_house: whereN[p], city_house: whereR[p],
                   meaning_city_house: root.AISTRO.houseMeaning(p, whereR[p], "person") });
    }
    const toList = (set) => [...set].sort().map((k) => { const [a, b] = k.split(" "); return { codes: [a, b], meaning: pictureMeaning(a, b) }; });
    return {
      axes: Object.fromEntries(PERSONAL.map((ax) => [ax, { natal: natal[ax], city: reloc[ax], shift: wrap180(reloc[ax] - natal[ax]) }])),
      pictures: { new: toList(new Set([...picR].filter((k) => !picN.has(k)))),
                  lost: toList(new Set([...picN].filter((k) => !picR.has(k)))),
                  kept: [...picR].filter((k) => picN.has(k)).sort().map((k) => k.split(" ")) },
      house_moves: moves, positions: reloc, natal_positions: natal,
      houses_natal: houseRows(natal), houses_city: houseRows(reloc),
    };
  }

  root.READING = {
    SIGNS_TH, DIGNITY, SIGN_RULER, HOUSE_WEIGHT, ASPECT_ORB_NATAL, NATAL_BODIES, DIAL, ORB_PICTURE,
    semiArc, lstOnAngle, paranLatitudes, mapParans, mapParansNear,
    signIndex, degInSign, dignityOf, wholeSignHouse, rulesHouses, aspectsTo, sectOf, natalLons,
    natalCondition, relocatedClassic, picturesWith, pairKey, houseRows, relocatedUranian, POLAR_LIMIT, assertHousable,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
