/* acg.js — เอนจินแผนที่ดวงฝั่งเบราว์เซอร์ (พอร์ตจาก acg/lines.py + acg/natal.py ของฝั่ง PC)
 *
 * ใช้คู่กับ engine.js ของแอปยูเรเนียน (ไม่แก้ไฟล์นั้น เรียกผ่าน global AISTRO):
 *   AISTRO.calc(code, jd)      ลองจิจูดสุริยยาตร (องศา)      — จาก ephem.bin.gz
 *   AISTRO.calcRaw(code+"B")   ละติจูดสุริยยาตร β (องศา)     — จาก beta.bin.gz (tools/gen_beta.py)
 *   AISTRO.calc("ST", jd)      เวลาดาราคติกรีนิช = GAST องศา — ตรง swe.sidtime()*15 เป๊ะ
 *   AISTRO.obliquity(jd)       มุมเอียงโลกจริง
 *
 * ทุกสูตรต้องให้ผลตรงกับฝั่ง Python ที่สอบเทียบกับ astro.com แล้ว (35,200 เส้น ≤2.4″)
 * — มีชุดเทสต์เทียบค่าต่อค่าใน mapapp/selftest.html กับ fixture ที่ Python สร้าง
 */
(function (root) {
  "use strict";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const KM_PER_DEG = 6371.0 * Math.PI / 180;   // รัศมีโลกเฉลี่ย IUGG 6371.0 กม. — ต้องเท่ากับ acg/lines.py เป๊ะ
  const ANGLES = ["MC", "IC", "AC", "DC"];
  // ราหูอยู่บนเส้นสุริยยาตรพอดี — ไม่มีตาราง β (gen_beta.py ข้ามไว้) จึงต้องคืน 0 เอง
  const NO_BETA = { MN: 1, NO: 1 };
  // ตารางของแอปเก็บ "ราหูจริง (NO)" แต่แผนที่ดวงใช้ "ราหูเฉลี่ย (MN)" ตามที่สอบเทียบกับ astro.com
  // ต่างกันได้ถึง 1.92° = เส้นเลื่อน 214 กม. (ใกล้ orb 240 กม.) จึงต้องอ่านจากซีรีส์ MNL ใน beta.bin.gz
  const LON_ALIAS = { MN: "MNL" };

  const mod360 = (v) => ((v % 360) + 360) % 360;
  const wrap180 = (v) => ((v + 180) % 360 + 360) % 360 - 180;

  /** (λ, β) → (α, δ) — หมุนรอบแกน x ด้วยมุมเอียงโลก (สูตรเดียวกับ acg/lines.py ecl_to_equ) */
  function eclToEqu(lon, lat, eps) {
    const l = lon * D2R, b = lat * D2R, e = eps * D2R;
    const sl = Math.sin(l), cl = Math.cos(l), sb = Math.sin(b), cb = Math.cos(b);
    const se = Math.sin(e), ce = Math.cos(e);
    const ra = Math.atan2(sl * ce - (sb / cb) * se, cl);
    const dec = Math.asin(sb * ce + cb * se * sl);
    return [mod360(ra * R2D), dec * R2D];
  }

  /** (α, δ) ของดาว ณ jd · method "mundo" = ใช้ β จริง · "eclpr" = ฉายลงเส้นสุริยยาตร (β = 0) */
  function bodyEqu(jd, code, method) {
    const eps = root.AISTRO.obliquity(jd);
    const lon = root.AISTRO.calc(LON_ALIAS[code] || code, jd);
    if (method === "eclpr") return eclToEqu(lon, 0, eps);
    const beta = NO_BETA[code] ? 0 : root.AISTRO.calcRaw(code + "B", jd);
    return eclToEqu(lon, beta, eps);
  }

  const gast = (jd) => mod360(root.AISTRO.calc("ST", jd));
  const mcLon = (ra, g) => wrap180(ra - g);
  const icLon = (ra, g) => wrap180(ra - g + 180);

  /** ลองจิจูดของเส้นที่ละติจูดนั้น — null = เส้นนี้ไม่ผ่านละติจูดนี้ (AC/DC มีขอบเขต) */
  function lineLon(angle, ra, dec, g, lat) {
    if (angle === "MC") return mcLon(ra, g);
    if (angle === "IC") return icLon(ra, g);
    const c = -Math.tan(lat * D2R) * Math.tan(dec * D2R);
    if (c < -1 || c > 1) return null;                 // ดาวไม่ขึ้น/ไม่ตกที่ละติจูดนี้
    const H0 = Math.acos(c) * R2D;                    // มุมชั่วโมงตอนอยู่ขอบฟ้า
    return wrap180(ra - g + (angle === "AC" ? -H0 : H0));
  }

  /** จุดบนทรงกลมหนึ่งหน่วยจาก (ละติจูด, ลองจิจูด) */
  function vec(lat, lon) {
    const p = lat * D2R, l = lon * D2R, cp = Math.cos(p);
    return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
  }
  const angBetween = (a, b) => {
    const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return Math.acos(d) * R2D;
  };

  const latlon = (v) => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [Math.asin(v[2] / n) * R2D, Math.atan2(v[1] / n, v[0] / n) * R2D];
  };

  /** ระยะเชิงมุม (องศาวงกลมใหญ่) จากพิกัดถึง "ครึ่งเส้น" ของมุมนั้น — พอร์ตตรงจาก acg/lines.py distance_deg
   *  MC/IC = ครึ่งเมริเดียน · AC/DC = ครึ่งวงกลมห่างจุดใต้ดาว (GP) 90°
   *  ถ้าจุดตั้งฉากตกนอกครึ่งเส้น ใช้ระยะถึงปลายครึ่งเส้นที่ใกล้กว่า */
  function distanceDeg(lat, lon, angle, ra, dec, g) {
    const p = vec(lat, lon), gpLon = wrap180(ra - g);
    if (angle === "MC" || angle === "IC") {
      const mLon = angle === "MC" ? gpLon : wrap180(gpLon + 180);
      const d = wrap180(lon - mLon);
      if (Math.abs(d) <= 90) {
        return Math.asin(Math.min(1, Math.cos(lat * D2R) * Math.abs(Math.sin(d * D2R)))) * R2D;
      }
      return 90 - Math.abs(lat);                      // ใกล้ขั้วโลกที่สุด
    }
    const n = vec(dec, gpLon);                        // ขั้วของวงกลมขอบฟ้า = GP
    const dot = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    const foot = [p[0] - dot * n[0], p[1] - dot * n[1], p[2] - dot * n[2]];
    const wantWest = angle === "AC";                  // ดาวขึ้น = ผู้ดูอยู่ทิศตะวันตกของ GP
    if (foot[0] * foot[0] + foot[1] * foot[1] + foot[2] * foot[2] > 1e-18) {
      const fLon = latlon(foot)[1];
      if ((wrap180(fLon - gpLon) < 0) === wantWest) return Math.abs(angBetween(p, n) - 90);
    }
    // ปลายครึ่งวงกลม = จุดเหนือสุด/ใต้สุดของขอบฟ้า (อยู่บนเมริเดียนของ GP)
    const j1 = dec <= 0 ? vec(dec + 90, gpLon) : vec(90 - dec, wrap180(gpLon + 180));
    const j2 = [-j1[0], -j1[1], -j1[2]];
    return Math.min(angBetween(p, j1), angBetween(p, j2));
  }

  const distanceKm = (lat, lon, angle, ra, dec, g) => {
    return distanceDeg(lat, lon, angle, ra, dec, g) * KM_PER_DEG;
  };

  /** เส้นสำหรับวาด: [[ [lat, lon], ... ]] ตัดช่วงเมื่อข้ามเส้นวันสากล */
  function polyline(angle, ra, dec, g, step, latMin, latMax) {
    step = step || 1; latMin = latMin === undefined ? -85 : latMin; latMax = latMax === undefined ? 85 : latMax;
    const segs = [];
    let cur = [], prev = null;
    const n = Math.round((latMax - latMin) / step);
    for (let i = 0; i <= n; i++) {
      const lat = latMin + i * step;
      const lon = lineLon(angle, ra, dec, g, lat);
      if (lon === null) {
        if (cur.length > 1) segs.push(cur);
        cur = []; prev = null; continue;
      }
      if (prev !== null && Math.abs(lon - prev) > 180) {
        if (cur.length > 1) segs.push(cur);
        cur = [];
      }
      cur.push([lat, lon]);
      prev = lon;
    }
    if (cur.length > 1) segs.push(cur);
    return segs;
  }

  /** {code: {ra, dec, gast, MC, IC}} — jdPos = ตำแหน่งดาว · jdFrame = กรอบเวลาดาราคติ (เส้นจรใช้เวลาเกิด) */
  function lineSet(jdPos, jdFrame, codes, method) {
    const g = gast(jdFrame), out = {};
    for (const code of codes) {
      const [ra, dec] = bodyEqu(jdPos, code, method);
      out[code] = { ra, dec, gast: g, MC: mcLon(ra, g), IC: icLon(ra, g) };
    }
    return out;
  }

  /** เส้นทั้งหมดที่ห่างพิกัดไม่เกิน orbKm เรียงจากใกล้สุด */
  function linesNear(lat, lon, set, orbKm) {
    const hits = [];
    for (const code in set) {
      const L = set[code];
      for (const ang of ANGLES) {
        const d = distanceKm(lat, lon, ang, L.ra, L.dec, L.gast);
        if (d !== null && d <= orbKm) hits.push({ body: code, angle: ang, km: d });
      }
    }
    return hits.sort((a, b) => a.km - b.km);
  }

  const TROPICAL_YEAR_DAYS = 365.24219;
  const progressedJd = (jdB, jdT) => jdB + (jdT - jdB) / TROPICAL_YEAR_DAYS;
  /** เส้นจร: ดาว ณ วันจร แต่กรอบมุมใช้เวลาดาราคติของ "วันเกิด" (วิธีของ astro.com) */
  const transitLines = (jdB, jdT, codes, method) => lineSet(jdT, jdB, codes, method);
  const progressedLines = (jdB, jdT, codes, method) => lineSet(progressedJd(jdB, jdT), jdB, codes, method);

  root.ACG = {
    D2R, R2D, KM_PER_DEG, ANGLES, mod360, wrap180,
    eclToEqu, bodyEqu, gast, mcLon, icLon, lineLon, LON_ALIAS,
    distanceDeg, distanceKm, polyline, lineSet, linesNear,
    progressedJd, transitLines, progressedLines, TROPICAL_YEAR_DAYS,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
