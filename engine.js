/* engine.js — เอนจินยูเรเนียนแบบ AISTRO พอร์ตจาก src/aistro.py (Python)
 *
 * ทำงานออฟไลน์เต็มรูปแบบ: ตำแหน่งดาวมาจากตาราง Chebyshev ใน ephem_data.js
 * (บีบอัดจาก Swiss Ephemeris/Moshier, คลาดเคลื่อน ≤ 0.001 พิลิปดา)
 * กติกาทุกข้อสอบเทียบกับเว็บ uraniansystem.com 8.25 แล้ว (fixture 100 ดวง)
 */
"use strict";

// ── ถอดรหัส base64 -> Float64Array ─────────────────────────────────────────
const _B64 = (() => {
  const t = new Int8Array(128).fill(-1);
  const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < 64; i++) t[s.charCodeAt(i)] = i;
  return t;
})();

function b64ToF64(str) {
  let n = str.length;
  while (n > 0 && str.charCodeAt(n - 1) === 61) n--;   // '='
  const bytes = new Uint8Array(Math.floor(n * 3 / 4));
  let bi = 0, acc = 0, bits = 0;
  for (let i = 0; i < n; i++) {
    acc = (acc << 6) | _B64[str.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[bi++] = (acc >> bits) & 0xFF;
    }
  }
  return new Float64Array(bytes.buffer, 0, bytes.length >> 3);
}

// ── ephemeris: ประเมินพหุนาม Chebyshev (Clenshaw) บนช่วงไม่สม่ำเสมอ ────────
// แต่ละดาวมีตารางขอบช่วง (starts, n+1 ค่า) — ช่วงถูกผ่าถี่ขึ้นแถว
// superior conjunction ที่ตำแหน่งมี "หลุม" จากการหักเหแสงโน้มถ่วงอาทิตย์
const EPH = {};
let _JD0 = 0, _JD1 = 0;

// ทางเดิม: ephem_data.js ประกาศ EPHEM_DATA ไว้ก่อนโหลดไฟล์นี้ (ใช้ในชุดเทสต์)
function initEphemJs(D) {
  for (const code in D.series) {
    const d = D.series[code];
    EPH[code] = { k: d.deg + 1, n: d.n, lin: d.lin || 0,
                  s: b64ToF64(d.s64), c: b64ToF64(d.b64) };
  }
  _JD0 = D.meta.jd0; _JD1 = D.meta.jd1;
}

// JXA (ตัวรันชุดเทสต์) ไม่มี TextDecoder จึงต้องถอด UTF-8 เอง
function utf8Decode(bytes) {
  if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xE0) s += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
    else if (b < 0xF0) {
      s += String.fromCharCode(((b & 0x0F) << 12)
        | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12)
        | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F) - 0x10000;
      s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return s;
}

// ทางใหม่สำหรับแอป: ไฟล์ไบนารี ephem.bin.gz — เล็กกว่า 37% และแยกส่วนเร็วกว่ามาก
// รูปแบบ: "URAN1" + u32 ความยาวหัว + u32 จำนวน float64 + หัว JSON + ข้อมูลสลับไบต์
function initEphemBinary(buf) {
  const u8 = new Uint8Array(buf);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4]);
  if (magic !== "URAN1") throw new Error("ไฟล์ตารางดาวไม่ถูกต้อง (magic=" + magic + ")");
  const dv = new DataView(buf);
  const hLen = dv.getUint32(5, true), nF64 = dv.getUint32(9, true);
  const head = JSON.parse(utf8Decode(u8.subarray(13, 13 + hLen)));
  // คลาย shuffle: ไบต์ลำดับที่ k ของทุกค่าถูกเก็บติดกันเป็นระนาบ
  const src = u8.subarray(13 + hLen);
  const flat = new Uint8Array(nF64 * 8);
  for (let k = 0; k < 8; k++) {
    const plane = k * nF64;
    for (let i = 0; i < nF64; i++) flat[i * 8 + k] = src[plane + i];
  }
  const all = new Float64Array(flat.buffer);
  for (const code in head.series) {
    const d = head.series[code];
    EPH[code] = { k: d.deg + 1, n: d.n, lin: d.lin || 0,
                  s: all.subarray(d.so, d.so + d.sl),
                  c: all.subarray(d.co, d.co + d.cl) };
  }
  _JD0 = head.meta.jd0; _JD1 = head.meta.jd1;
}

async function loadEphem(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("โหลดตารางดาวไม่สำเร็จ: HTTP " + res.status);
  let buf;
  if (typeof DecompressionStream === "function") {
    buf = await new Response(
      res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  } else {
    throw new Error("เบราว์เซอร์นี้ไม่รองรับ DecompressionStream");
  }
  initEphemBinary(buf);
  return { jd0: _JD0, jd1: _JD1, bodies: Object.keys(EPH).length };
}

if (typeof EPHEM_DATA !== "undefined") initEphemJs(EPHEM_DATA);

// นอกช่วงตารางดาว พหุนามจะให้ค่ามั่วโดยไม่มีสัญญาณเตือน — ต้องหยุดให้ชัด
function assertRange(jd, what) {
  if (!(jd >= _JD0 && jd <= _JD1)) {
    const y = revjul(jd)[0];
    throw new RangeError(
      `${what} ปี ค.ศ. ${y} อยู่นอกช่วงข้อมูล (ค.ศ. 1900–2099 / พ.ศ. 2443–2642)`);
  }
}

function calcRaw(code, jd) {
  assertRange(jd, "วันที่");
  const s = EPH[code];
  // binary search: ช่วง i ที่ starts[i] <= jd < starts[i+1]
  let lo = 0, hi = s.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.s[mid] <= jd) lo = mid; else hi = mid - 1;
  }
  const i = lo, t0 = s.s[i], t1 = s.s[i + 1];
  const x = 2 * (jd - t0) / (t1 - t0) - 1;
  const k = s.k, off = i * k, c = s.c;
  let b1 = 0, b2 = 0;
  for (let j = k - 1; j >= 1; j--) {
    const b0 = c[off + j] + 2 * x * b1 - b2;
    b2 = b1;
    b1 = b0;
  }
  const v = c[off] + x * b1 - b2;
  if (!s.lin) return v;
  // ST เก็บเป็น "ส่วนต่างจากเส้นตรง" — บวกกลับแบบรักษาความละเอียด
  // (แยก 360°/วัน ออกก่อน ไม่งั้นตัวเลขโตจนเสียนัยสำคัญ)
  const n = jd - _JD0;
  return v + 360 * (n - Math.floor(n)) + (s.lin - 360) * n;
}

const mod360 = (v) => ((v % 360) + 360) % 360;
const calc = (code, jd) => mod360(calcRaw(code, jd));
const obliquity = (jd) => calcRaw("EPS", jd);

// ── ปฏิทิน (เทียบเท่า swe.julday / swe.revjul แบบเกรกอเรียน) ───────────────
function julday(y, m, d, h) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy
    + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return jdn - 0.5 + h / 24;
}

function revjul(jd) {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524, c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c), e = Math.floor((b - dd) / 30.6001);
  const day = b - dd - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return [year, month, day, f * 24];
}

// ── มุมเจ้าชะตา (สูตรปิด — พิสูจน์ตรง swe.houses 0.000000″) ────────────────
const D2R = Math.PI / 180;

function anglesAt(jd, lat, lon) {
  const armc = mod360(calc("ST", jd) + lon);
  const ar = armc * D2R, er = obliquity(jd) * D2R, fr = lat * D2R;
  const mc = mod360(Math.atan2(Math.sin(ar), Math.cos(ar) * Math.cos(er)) / D2R);
  const asc = mod360(Math.atan2(Math.cos(ar),
    -(Math.sin(ar) * Math.cos(er) + Math.tan(fr) * Math.sin(er))) / D2R);
  return { asc, mc, armc };
}

// ── ค่าคงที่แบบ AISTRO ─────────────────────────────────────────────────────
const SIDEREAL_YEAR = 365.25636;
const TROPICAL_MONTH = 27.321582;
const DIAL_DEFAULT = 22.5;
const ORB_RT = 1.0;
const ORB_T1 = 0.125;
const ORB_T23 = 0.25;

const CODE_ORDER = ["AR", "MC", "AS", "SU", "MO", "NO", "ME", "VE", "MA", "JU",
  "SA", "UR", "NE", "PL", "CU", "HA", "ZE", "KR", "AP", "AD", "VU", "PO"];
const BODY_CODES = ["SU", "MO", "ME", "VE", "MA", "JU", "SA", "UR", "NE", "PL",
  "NO", "CU", "HA", "ZE", "KR", "AP", "AD", "VU", "PO"];
const MONTH_TABLE_TRANSITS = ["NO", "JU", "SA", "UR", "NE", "PL", "CU", "HA",
  "ZE", "KR", "AP", "AD", "VU", "PO"];

const FACTOR_CLASS = {};
for (const k of ["AR", "MC", "AS", "SU", "MO", "NO"]) FACTOR_CLASS[k] = "personal";
for (const k of ["VE", "JU", "KR", "AP"]) FACTOR_CLASS[k] = "good";
for (const k of ["SA", "NE", "HA", "AD"]) FACTOR_CLASS[k] = "bad";
for (const k of ["MA", "UR", "PL", "ZE", "VU"]) FACTOR_CLASS[k] = "booster";
for (const k of ["ME", "CU", "PO"]) FACTOR_CLASS[k] = "neutral";

// ── ดวงกำเนิดและชั้นดวง ────────────────────────────────────────────────────
function buildRadix(y, m, d, hour, tz, lat, lon) {
  const jd = julday(y, m, d, hour - tz);
  const R = {};
  for (const c of BODY_CODES) R[c] = calc(c, jd);
  const ang = anglesAt(jd, lat, lon);
  R.AS = ang.asc;
  R.MC = ang.mc;
  R.AR = 0.0;
  return { R, jd };
}

function elapsedYears(jdBirth, jdTransit, tz) {
  if (tz === undefined) tz = 7.0;
  const p = revjul(jdBirth + tz / 24);
  const yb = p[0], mb = p[1], db = p[2], hb = p[3];
  const anniv = (k) => julday(yb + k, mb, db, hb - tz);
  let k = Math.floor((jdTransit - jdBirth) / 365.25);
  while (anniv(k) > jdTransit) k--;
  while (anniv(k + 1) <= jdTransit) k++;
  const a = anniv(k), b = anniv(k + 1);
  return k + (jdTransit - a) / (b - a);
}

// tz ต้องไหลไปถึง elapsedYears ทุกเส้นทาง — วันครบรอบปีอ่านจาก "ปฏิทินท้องถิ่น"
// ของเจ้าชะตา ถ้าปล่อยให้ตกไปใช้ค่าปริยาย +7 คนเกิดใกล้เที่ยงคืนในเขตเวลาอื่น
// จะได้วันครบรอบเลื่อนไป 1 วัน (โค้งเพี้ยนราว 9.7″ ต่อวัน · จันทร์ 130″)
const progressedJd = (jdB, jdT, tz) => jdB + elapsedYears(jdB, jdT, tz);
const tertiary1Jd = (jdB, jdT) =>
  jdB + Math.floor((jdT - jdB) / TROPICAL_MONTH);
const minorJd = (jdB, jdT, tz) =>
  jdB + Math.floor(elapsedYears(jdB, jdT, tz)) * TROPICAL_MONTH;

const solarArc = (jdB, jdT, tz) =>
  mod360(calc("SU", progressedJd(jdB, jdT, tz)) - calc("SU", jdB));
const lunarArc = (jdB, jdT, tz) =>
  mod360(calc("MO", progressedJd(jdB, jdT, tz)) - calc("MO", jdB));

function leapBirthExtraDays(jdBirth, tz) {
  if (tz === undefined) tz = 7.0;
  const p = revjul(jdBirth + tz / 24);
  return (p[1] === 2 && p[2] === 29) ? 1.0 : 0.0;
}

// ชดเชย 29 ก.พ. เฉพาะเมื่อดวงจรอยู่ "หลัง" เวลาเกิดจริง
// เหตุผล: anniv(0) = julday(ปีเกิด, 2, 29, …) = เวลาเกิดเป๊ะเสมอ (ปีเกิดเป็น
// อธิกสุรทินแน่นอน) ปัญหา "1 มี.ค." เกิดกับ anniv(k) ที่ k ≥ 1 เท่านั้น
// ที่อายุ 0 พอดี โค้งจึงต้องเป็น 0.000000° ไม่ใช่ 9.7″ และชั้น v1/v2/l1/l2
// ต้องเท่าดวงกำเนิดเป๊ะ · ก่อนเกิด (โค้งติดลบ) ก็ไม่มีวันครบรอบให้ชดเชย
function arcExtraDays(jdBirth, jdTransit, tz) {
  return jdTransit > jdBirth ? leapBirthExtraDays(jdBirth, tz) : 0.0;
}

function chartAt(jd, lat, lon) {
  const R = {};
  for (const c of BODY_CODES) R[c] = calc(c, jd);
  const ang = anglesAt(jd, lat, lon);
  R.AS = ang.asc;
  R.MC = ang.mc;
  R.AR = 0.0;
  return R;
}

function layerPositions(radix, jdBirth, jdTransit, layer, lat, lon, tz) {
  if (lat === undefined) lat = 13.7563;
  if (lon === undefined) lon = 100.5018;
  const extra = arcExtraDays(jdBirth, jdTransit, tz);
  if (layer === "r") return Object.assign({}, radix);
  if (layer === "v1" || layer === "v2") {
    // คนเกิด 29 ก.พ. ต้องชดเชย 1 วัน — ปีไม่อธิกสุรทินไม่มี 29 ก.พ. julday()
    // จึงเลื่อนไป 1 มี.ค. ทำให้อายุ (และโค้ง) สั้นไปราว 10" · เทียบเว็บแล้วตรง 0.00"
    // (monthTable ชดเชยข้อนี้อยู่แล้ว v1/v2 เพิ่งตามมาให้ตรงกัน — ส.ค. 2026)
    // fixture: export_axis_v/site2_12.txt (เกิด 29 ก.พ. 2000)
    const arc = solarArc(jdBirth, jdTransit + extra, tz);
    const s = layer === "v1" ? arc : -arc;
    const out = {};
    for (const k in radix) out[k] = mod360(radix[k] + s);
    return out;
  }
  if (layer === "l1" || layer === "l2") {
    // ชดเชยวันเกิด 29 ก.พ. เหมือน v1/v2 — จันทร์เดินเร็ว ผิดถึง 117.77"
    // สอบเทียบเว็บแล้วตรง 0.00" · fixture: export_axis_v/sitel_00,02,03
    const arc = lunarArc(jdBirth, jdTransit + extra, tz);
    const s = layer === "l1" ? arc : -arc;
    const out = {};
    for (const k in radix) out[k] = mod360(radix[k] + s);
    return out;
  }
  const jd = { p: progressedJd(jdBirth, jdTransit, tz),
               tp1: tertiary1Jd(jdBirth, jdTransit),
               tp2: minorJd(jdBirth, jdTransit, tz),
               t: jdTransit }[layer];
  const out = chartAt(jd, lat, lon);
  // คนเกิด 29 ก.พ. — เว็บคิด "มุมเจ้าชะตา" ของชั้นโปรเกรสช้ากว่าดาวไป 1 วัน
  // (โลกหมุนสุทธิ ~1.07°/วัน) · ตำแหน่งดาวชั้น p ไม่ต้องชดเชย และชั้น tp1/tp2
  // ก็ไม่ต้อง — พิสูจน์จากเว็บ 6 ดวงอธิกสุรทิน + 2 ดวงคุม (export_axis_v/site_layer_p.json):
  //   MCp/ASp ของเรา ต่างเว็บ 54–65′ → ชดเชยแล้วเหลือ 0.0–0.7′
  //   MCtp1 ตรงอยู่แล้ว 0.1–0.4′ → ถ้าชดเชยจะพัง 54–65′
  //   ดวงเกิดปกติ ตรงอยู่แล้วทั้งคู่ → ถ้าชดเชยจะพัง (leapBirthExtraDays คืน 0 จึงไม่แตะ)
  if (layer === "p") {
    if (extra) {
      const ang = anglesAt(jd + extra, lat, lon);
      out.AS = ang.asc;
      out.MC = ang.mc;
    }
  }
  return out;
}

// ── ตารางดูดวงจร ±6 เดือน ──────────────────────────────────────────────────
function rank(codes) {
  const known = CODE_ORDER.filter((c) => codes.indexOf(c) >= 0);
  return known.concat(codes.filter((c) => CODE_ORDER.indexOf(c) < 0));
}

function dialGap(a, b, dial) {
  const d = Math.abs(a - b) % dial;
  return Math.min(d, dial - d);
}

function monthTable(radix, jdBirth, year, month, opt) {
  opt = opt || {};
  const dial = opt.dial === undefined ? DIAL_DEFAULT : opt.dial;
  const jdTransit = opt.jdTransit === undefined ? null : opt.jdTransit;
  let hourUt = opt.hourUt === undefined ? null : opt.hourUt;
  const arcBias = opt.arcBiasHours === undefined ? 0.0 : opt.arcBiasHours;
  const tz = opt.tz;
  if (hourUt === null) {
    hourUt = jdTransit === null ? 12.0
      : (((jdTransit + 0.5) % 1.0 + 1.0) % 1.0) * 24.0;
  }
  const jdRef = julday(year, month, 15, hourUt);
  const arc = solarArc(jdBirth,
    jdRef + arcBias / 24.0 + arcExtraDays(jdBirth, jdRef, tz), tz);
  const tpos = {};
  for (const c of MONTH_TABLE_TRANSITS) tpos[c] = calc(c, jdRef);
  const half = dial / 2.0;
  const codes = rank(Object.keys(radix));

  const hits = (target, period, orb) => {
    // เผื่อ epsilon กันปัดเศษทศนิยม — เจอเคส |โค้ง−เป้า| = 0.250000 พอดี
    const d = ((arc - target) % period + period) % period;
    return Math.min(d, period - d) <= orb + 1e-9;
  };

  const transitsNear = (anchors) => {
    // ดาวจรเรียง "ทีละจุดยึด" ตามที่เว็บแสดงจริง
    const out = [];
    for (const a of anchors) {
      for (const c of CODE_ORDER) {
        if (out.indexOf(c) < 0 && c in tpos
            && dialGap(tpos[c], a, dial) <= ORB_RT) {
          out.push(c);
        }
      }
    }
    return out;
  };

  const rows = [];
  // T1 — v1 = v2 (สองดวงวิ่งเข้าหากันที่จุดกึ่งกลางกำเนิด)
  for (const x of codes) {
    for (const y of codes) {
      if (x === y) continue;
      const t = (((radix[y] - radix[x]) % dial) + dial) % dial / 2.0;
      if (hits(t, half, ORB_T1)) {
        const mid = mod360((radix[x] + radix[y]) / 2.0) % dial;
        const nat = rank(codes).filter(
          (q) => dialGap(radix[q], mid, dial) <= ORB_RT);
        rows.push({ kind: 1, lead: [x, y], natal: nat,
                    transit: transitsNear([mid]) });
      }
    }
  }
  // T2/T3/T4 — ยึดที่ดาวกำเนิด y
  for (const y of codes) {
    const nearY = rank(codes).filter(
      (q) => q !== y && dialGap(radix[q], radix[y], dial) <= ORB_RT);
    const anchors = [((radix[y] % dial) + dial) % dial]
      .concat(nearY.map((q) => ((radix[q] % dial) + dial) % dial));
    const tr = transitsNear(anchors);
    for (const x of codes) {
      if (x === y) continue;
      // ลูกโซ่รวมดาวที่กำลังเคลื่อน (x) ด้วยถ้าอยู่ในระยะ — เว็บพิมพ์ซ้ำจริง
      if (hits((((radix[y] - radix[x]) % dial) + dial) % dial, dial, ORB_T23)) {
        rows.push({ kind: 2, lead: [y, x], natal: nearY, transit: tr });
      }
      if (hits((((radix[x] - radix[y]) % dial) + dial) % dial, dial, ORB_T23)) {
        rows.push({ kind: 3, lead: [y, x], natal: nearY, transit: tr });
      }
    }
    const t4 = transitsNear([((radix[y] % dial) + dial) % dial]);
    if (t4.length) rows.push({ kind: 4, lead: [y], natal: [], transit: t4 });
  }
  rows.sort((a, b) => a.kind - b.kind
    || CODE_ORDER.indexOf(a.lead[0]) - CODE_ORDER.indexOf(b.lead[0])
    || CODE_ORDER.indexOf(a.lead[a.lead.length - 1])
       - CODE_ORDER.indexOf(b.lead[b.lead.length - 1]));
  return rows;
}

// ── ช่วงวันที่จริงของแต่ละแถว ─────────────────────────────────────────────
// แถวหนึ่งไม่ได้ทำงานทั้งเดือน — โค้งสุริยยาตร์ (หรือดาวจร) เข้า-ออกระยะ orb
// ในช่วงวันที่แน่นอน T1 ราว 93 วัน · T2/T3 ราว 185 วัน · T4 แล้วแต่ความเร็วดาว
const ARC_DEG_PER_DAY = 0.9856 / 365.25;

// %% = mod ที่ให้ผลบวกเสมอ — JS ต่างจาก Python ตรงนี้ ถ้าลืมจะได้วันผิดครึ่งรอบ
const wrapHalf = (v, period) =>
  ((((v + period / 2) % period) + period) % period) - period / 2;

// แก้สมการ "โค้งเท่ากับ target" → คืน **วันจริงตามปฏิทิน**
// ทุกที่ในโปรแกรมคิดโค้งเป็น solarArc(jdBirth, วันจริง + ชดเชย 29 ก.พ.)
// ถ้าที่นี่แก้สมการบน solarArc ดิบ ๆ วันที่คืนออกไปจะเป็น "วันจริง + ชดเชย"
// คนเกิด 29 ก.พ. จึงเห็นวันในไทม์ไลน์/แผนที่ชีวิต/ศูนย์รังสี ช้าไป 1 วันทุกแถว
// วิธีแก้: แก้สมการในโดเมนที่ชดเชยแล้ว (เลื่อน hint เข้าไป) แล้วเลื่อนกลับตอนคืนค่า
function solveArcDate(jdBirth, target, jdHint, period, tz) {
  const extra = arcExtraDays(jdBirth, jdHint, tz);
  const arc0 = solarArc(jdBirth, jdHint + extra, tz);
  let jd = jdHint + extra + wrapHalf(target - arc0, period) / ARC_DEG_PER_DAY;
  // นิวตันลู่เข้าเร็วมาก (residual หาร ~30 ทุกรอบ) แต่ไปจบที่ **วงวนถาวร**
  // ราว 1.7e-10° ซึ่งต่ำกว่าความละเอียดของ double ที่ค่าระดับ 360 —
  // เกณฑ์ 1e-10 จึงไม่มีวันเป็นจริง ลูปเลยวนครบ 80 รอบทุกครั้ง
  //   วัดจริง 3,000 เคส: เฉลี่ย 48.8 รอบ/ครั้ง · 652 ms
  //   ตัวอย่าง d: 8.1e-2 → 2.7e-3 → 9.2e-5 → 3.1e-6 → 1.0e-7 → 3.6e-9
  //              → −1.70e-10 → −1.70e-10 → 3.05e-10 → −1.70e-10 → … วนไม่จบ
  // จึงเก็บรอบที่ residual ต่ำสุดไว้ แล้วหยุดทันทีที่ "ไม่ดีขึ้นแล้ว"
  //   หลังแก้: 6.9 รอบ/ครั้ง · 114 ms (เร็วขึ้น 5.7×)
  //   residual แย่สุด 4.39e-10° เทียบของเดิม 3.64e-10° (คือแม่นเท่าเดิม
  //   ต่างกัน ~3 มิลลิวินาทีของเวลา ตารางแสดงถึงระดับนาที)
  // **ไม่ใช้วิธีคลายเกณฑ์เป็น 1e-9** — เร็วพอกัน (5.9 รอบ) แต่ residual
  // แย่ลงเป็น 9.99e-10° คือยอมเสียความแม่นโดยไม่ได้อะไรกลับมา
  let best = jd, bestD = Infinity;
  for (let i = 0; i < 80; i++) {
    const d = wrapHalf(solarArc(jdBirth, jd, tz) - target, period);
    const ad = Math.abs(d);
    if (ad >= bestD) break;          // ถึงพื้นความละเอียดแล้ว
    bestD = ad; best = jd;
    if (ad < 1e-10) break;
    jd -= d / ARC_DEG_PER_DAY;
  }
  return best - extra;
}

// กริดดาวจรของเดือนหนึ่ง คิดครั้งเดียวแล้วใช้ซ้ำทุกแถว — ไม่งั้นช้าเป็นสิบเท่า
let _grid = null;
function transitGrid(jdRef, span, step) {
  if (_grid && _grid.jdRef === jdRef && _grid.span === span
      && _grid.step === step) return _grid;
  const lo = Math.max(_JD0, jdRef - span / 2);
  const hi = Math.min(_JD1, jdRef + span / 2);
  const n = Math.max(2, Math.floor((hi - lo) / step) + 1);
  const jds = new Float64Array(n), g = {};
  for (const c of MONTH_TABLE_TRANSITS) g[c] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const jd = lo + i * step;
    jds[i] = jd;
    for (const c of MONTH_TABLE_TRANSITS) g[c][i] = calc(c, jd);
  }
  _grid = { jdRef, span, step, jds, g };
  return _grid;
}

function transitWindows(natal, bodies, jdRef, dial, orb, span, step) {
  const G = transitGrid(jdRef, span, step);
  const out = [];
  for (const code of bodies) {
    if (!(code in G.g)) continue;
    const arr = G.g[code];
    let inside = null, bestG = 0, bestJd = 0;
    for (let i = 0; i < arr.length; i++) {
      const gap = dialGap(arr[i], natal, dial);
      if (gap <= orb) {
        if (inside === null) { inside = G.jds[i]; bestG = gap; bestJd = G.jds[i]; }
        else if (gap < bestG) { bestG = gap; bestJd = G.jds[i]; }
      } else if (inside !== null) {
        out.push([code, inside, bestJd, G.jds[i]]);
        inside = null;
      }
    }
    // ดาวพักร์ทำให้เข้า-ออกได้หลายรอบ จึงเก็บทุกรอบ ไม่ใช่รอบเดียว
    if (inside !== null) out.push([code, inside, bestJd, G.jds[G.jds.length - 1]]);
  }
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

function activationDates(radix, jdBirth, row, jdRef, opt) {
  opt = opt || {};
  const dial = opt.dial === undefined ? DIAL_DEFAULT : opt.dial;
  const span = opt.spanDays === undefined ? 400.0 : opt.spanDays;
  const step = opt.stepDays === undefined ? 0.5 : opt.stepDays;
  const tz = opt.tz;
  if (row.kind === 4) {
    return transitWindows(radix[row.lead[0]], row.transit, jdRef,
                          dial, ORB_RT, span, step);
  }
  let target, period, orb;
  const mod = (v) => ((v % dial) + dial) % dial;
  if (row.kind === 1) {
    target = mod(radix[row.lead[1]] - radix[row.lead[0]]) / 2.0;
    period = dial / 2.0; orb = ORB_T1;
  } else if (row.kind === 2) {
    target = mod(radix[row.lead[0]] - radix[row.lead[1]]);
    period = dial; orb = ORB_T23;
  } else {
    target = mod(radix[row.lead[1]] - radix[row.lead[0]]);
    period = dial; orb = ORB_T23;
  }
  const exact = solveArcDate(jdBirth, target, jdRef, period, tz);
  const a = solveArcDate(jdBirth, target - orb, exact, period, tz);
  const b = solveArcDate(jdBirth, target + orb, exact, period, tz);
  return [["โค้ง", Math.min(a, b), exact, Math.max(a, b)]];
}

// ── ตารางศูนย์รังสี 360° — แถวดิบ ─────────────────────────────────────────
// "ดาวหลักถูกโค้งสุริยยาตร์พาไปทับจุดที่อยู่นิ่ง แล้ววันนั้นคือวันไหน"
// ย้ายมาจาก index.html (ส.ค. 2026) เพราะเป็นคณิตศาสตร์ล้วน ไม่แตะ DOM เลย
// อยู่ในเอนจินแล้วเทสต์ JXA เข้าถึงได้ · ดู test_ctr.js
//
// opt:
//   layers   {ชั้น: {รหัสดาว: องศา}}  ตำแหน่งที่คำนวณไว้แล้ว (จาก layerPositions)
//   srcs     ชั้นของ "จุด" ที่จะไล่ ตามลำดับที่ต้องการให้ออกมาในผล
//   main     องศาของดาวหลัก (ผู้เรียกดึงมาเองว่าจะเอาจากชั้นไหน)
//   single   เอาจุดที่เป็นดาวเดี่ยว · mid  เอาจุดที่เป็นศูนย์รังสีของคู่ดาว
//   step     จานกระตุ้น 360/90/45/22.5
//   jdBirth · jdEnd · tz · sixty (เปิดจุดมุม 60°) · orbA (ปริยาย 1)
//
// คืนแถว {n, s, deg, one?, a?, b?, off, ang?, orb?, arc, jd, age, hit}
//   arc  โค้งที่ต้องเดินจากดาวหลักถึงจุดนั้น    jd  วันที่โค้งเดินถึงจริง
//   ang/orb  มุมที่จุดนี้ทำกับดาวหลัก "อยู่แล้ว" ตั้งแต่กำเนิด (คนละเรื่องกับ arc)
//   hit  มุมที่กระตุ้นครั้งนั้น — ดูหมายเหตุเรื่องคาบข้างล่าง
function radiationRows(opt) {
  const layers = opt.layers, srcs = opt.srcs, main = opt.main;
  const single = !!opt.single, mid = !!opt.mid;
  const step = opt.step === undefined ? 360 : opt.step;
  const jdBirth = opt.jdBirth, jdEnd = opt.jdEnd, tz = opt.tz;
  const sixty = !!opt.sixty;
  const orbA = opt.orbA === undefined ? 1 : opt.orbA;

  const pts = [];
  for (const s of srcs) {
    const P = layers[s];
    if (!P) continue;
    const codes = CODE_ORDER.filter((c) => P[c] !== undefined);
    if (single) for (const c of codes) pts.push({ n: c, s, deg: P[c], one: true });
    if (mid) for (let i = 0; i < codes.length; i++)
      for (let j = i + 1; j < codes.length; j++)
        pts.push({ n: codes[i] + "/" + codes[j], s,
                   deg: midpointShort(P[codes[i]], P[codes[j]]),
                   a: codes[i], b: codes[j] });
  }

  // โค้งเดินหน้าอย่างเดียว "วันสิ้นสุด" จึงแปลงเป็น "โค้งสูงสุด" ได้ครั้งเดียว
  // ไม่งั้นต้อง solve จุดถัดไปก่อนถึงจะรู้ว่าเลยช่วงแล้ว = เสีย 1 solve ต่อจุดเสมอ
  // (จาน 360°: 253 → 62 solves · จาน 22.5°: 1,615 → 1,362)
  // ถ้าอายุที่ขอเลยช่วงข้อมูล ปล่อยให้ใช้เกณฑ์วันแบบเดิมไป ไม่ต้องเดา
  const arcCap = jdEnd <= _JD1
    ? solarArc(jdBirth, jdEnd + arcExtraDays(jdBirth, jdEnd, tz), tz)
    : Infinity;

  const out = [];
  for (const p of pts) {
    p.off = mod360(p.deg - main);
    const f = aspectTrue(sepCircle(p.deg, main), sixty);
    if (f.orb <= orbA) { p.ang = f.ang; p.orb = f.orb; }
    // ── คาบของแถว: ดาวเดี่ยว = เต็มจาน · ศูนย์รังสี = ครึ่งจาน ─────────────
    // ดาวเดี่ยว: มีแค่ดาวหลักที่เดิน จุดอยู่นิ่ง → แตะทุกครั้งที่ arc ≡ off (mod จาน)
    // ศูนย์รังสี (คู่ดาว): แถวนี้คือเหตุการณ์ T1 คือ **v1(ก) = v2(ข)**
    //   ก เดินหน้า +โค้ง · ข สวนมา −โค้ง → ระยะบนจานปิดเร็วเป็นสองเท่า
    //   (ก+a) − (ข−a) ≡ 0 (mod จาน) ⟺ a ≡ off (mod จาน/2)   [off = กึ่งกลาง − ก]
    //   **คาบจึงเป็นครึ่งจาน** ตรงกับที่ monthTable ใช้กับแถว T1 อยู่แล้ว
    //   (`add(1, …, dial/2, ORB_T1)` เทียบกับ `dial` สำหรับ T2/T3)
    // มุมของแถวศูนย์รังสีจึงเป็น "กุม" เสมอ — ณ จังหวะนั้น v1 กับ v2 ทับกันบนจานพอดี
    const st = p.one ? step : step / 2;
    for (let arc = ((p.off % st) + st) % st; ; arc += st) {
      if (arc > arcCap) break;
      const jd = solveArcDate(jdBirth, arc, jdBirth + arc / 0.9856 * 365.25, 360, tz);
      if (jd > jdEnd) break;
      let hit = 0;
      if (p.one) {
        const h = Math.round(mod360(p.off - arc) * 1000) / 1000;
        hit = h > 180 ? 360 - h : h;              // พับมุมให้อยู่ใน 0–180 แบบเว็บ
      }
      out.push(Object.assign({}, p, { arc, jd,
        age: (jd - jdBirth) / 365.2422, hit }));
      if (st >= 360) break;
    }
  }
  return out;
}

// ── ตรวจสูตร: "สมการนี้เกิดไหม เมื่อไหร่" ─────────────────────────────────
// ย้ายมาจาก index.html (ส.ค. 2026) — ส่วนคำนวณล้วน ๆ ไม่แตะ DOM · ดู test_formula.js
//
// สัมประสิทธิ์โค้ง k ของแต่ละชั้น: v1 = กำเนิด+โค้ง (k=+1) · v2 = กำเนิด−โค้ง (k=−1)
// ที่เหลือเป็น "ภาพนิ่ง ณ เวลาดวงจรที่กรอก" จึงไม่ขยับตามโค้ง (k=0) เหมือนชั้น r
const FORMULA_K = { r: 0, p: 0, tp1: 0, tp2: 0, l1: 0, l2: 0, t: 0, v1: 1, v2: -1 };
const FORMULA_SNAP = ["p", "tp1", "tp2", "l1", "l2", "t"];

// อ่านข้างหนึ่งของสมการ — 3 รูปแบบ: "SU" · "SU/MO" · "SU+MO-AR"
// ใส่ชั้นท้ายดาวได้ (SUv1) ไม่ใส่ = ใช้ defLay
function parseFormulaSide(txt, defLay) {
  const t = String(txt).replace(/\s+/g, "");
  if (!t) throw new Error("ว่างเปล่า");
  const one = (tok) => {
    const m = tok.match(/^([A-Za-z]{2})(r|p|tp1|tp2|v1|v2|l1|l2|t)?$/);
    if (!m) throw new Error(`อ่านปัจจัย "${tok}" ไม่ออก`);
    const c = m[1].toUpperCase();
    if (CODE_ORDER.indexOf(c) < 0) throw new Error(`ไม่รู้จักดาว "${c}"`);
    return { c, s: m[2] || defLay };
  };
  if (t.indexOf("/") >= 0) {
    const q = t.split("/");
    if (q.length !== 2) throw new Error("ศูนย์รังสีต้องมี 2 ดาว");
    return { kind: "mid", f: q.map(one) };
  }
  if (/[+\-]/.test(t)) {
    const q = t.match(/^([A-Za-z]{2}[a-z0-9]*)\+([A-Za-z]{2}[a-z0-9]*)-([A-Za-z]{2}[a-z0-9]*)$/);
    if (!q) throw new Error("สูตร 4 ปัจจัยต้องเป็นรูป A+B-C");
    return { kind: "abc", f: [one(q[1]), one(q[2]), one(q[3])] };
  }
  return { kind: "one", f: [one(t)] };
}

// คืน 3 ค่า: deg = องศาจริงตอนนี้ (ไว้แสดง) · base = องศาตอนโค้ง = 0 (ไว้แก้สมการ)
//           k   = สัมประสิทธิ์โค้งรวมของข้างนี้
// สำคัญ: ชั้น v1/v2 มี "โค้งวันนี้" บวกอยู่แล้ว ถ้าเอาไปบวก k·arc ซ้ำจะนับสองรอบ
// จึงต้องถอยกลับไปใช้องศาชั้นกำเนิดเป็นฐานเสมอเวลาแก้สมการ
function evalFormulaSide(side, layers) {
  const at = (x) => {
    if (!layers[x.s] || layers[x.s][x.c] === undefined)
      throw new Error(`ไม่มี ${x.c} ในชั้น ${x.s}`);
    return layers[x.s][x.c];
  };
  const deg = side.f.map(at);
  const ks = side.f.map((x) => FORMULA_K[x.s]);
  // ชั้น v1/v2 คือ "กำเนิด ± โค้ง" ฐานตอนโค้ง = 0 จึงต้องอ่านจากชั้นกำเนิด
  // ถ้าผู้เรียกไม่ได้ใส่ชั้น r มาด้วย ต้องฟ้องให้รู้เรื่อง ไม่ใช่ TypeError ดิบ ๆ
  if (side.f.some((x) => FORMULA_K[x.s] !== 0) && !layers.r)
    throw new Error("ต้องมีชั้นกำเนิด (r) ในตารางตำแหน่ง เพราะชั้น v1/v2 " +
                    "ใช้ชั้นกำเนิดเป็นฐานตอนโค้ง = 0");
  const base = side.f.map((x) => (FORMULA_K[x.s] === 0 ? at(x) : layers.r[x.c]));
  const comb = (v) => side.kind === "mid" ? midpointShort(v[0], v[1])
    : side.kind === "abc" ? mod360(v[0] + v[1] - v[2]) : v[0];
  const k = side.kind === "mid" ? (ks[0] + ks[1]) / 2
    : side.kind === "abc" ? ks[0] + ks[1] - ks[2] : ks[0];
  return { deg: comb(deg), base: comb(base), k };
}

// แก้สมการ "ข้างซ้ายทำมุมเป้าหมายกับข้างขวา" → คืนทุกครั้งที่โค้งพาให้เกิด
//   (baseA + kA·arc) − (baseB + kB·arc) ≡ มุมเป้าหมาย
//   → arc ≡ (เป้าหมาย − Δฐาน) / (kA − kB)   คาบ = |360 / (kA − kB)|
// ถ้าสองข้างขยับเท่ากัน (kA = kB รวมกรณีนิ่งทั้งคู่) ระยะห่างไม่เปลี่ยนเอง
// → เดินโค้งที่ฝั่งซ้าย (dk = 1) เหมือนที่ตารางศูนย์รังสีเดินโค้งที่ดาวหลัก
//
// opt: layers · sideA · sideB (จาก parseFormulaSide) · jdBirth · jdStart · jdEnd
//      step (จานกระตุ้น) · pick (มุมเจาะจง หรือ null = ไล่ตามจาน)
//      angOn (null = ทุกมุม · {มุม:true} = เฉพาะที่ติ๊ก) · orbMax · sixty · tz
// ── ดาวจรจริงเดินมาทำมุมเมื่อไหร่ ────────────────────────────────────────
// **คนละกลไกกับ formulaSolve()** ซึ่งเดินด้วยโค้งสุริยยาตร์
// อันนี้สแกน "เวลาจริง" หาจุดที่ดาวจรเดินมาทำมุมกับจุดคงที่ — จับถอยหลัง
// (retrograde) ได้ด้วย เพราะดูการเปลี่ยนเครื่องหมาย ไม่ได้เดินทางเดียว
//
// ความเร็วเชิงมุมโดยประมาณ (องศา/วัน) — ใช้เลือกขนาดก้าวสแกนให้พอดีกับ
// ดาวที่เร็วที่สุดในสมการ ก้าวใหญ่ไปจะกระโดดข้ามจุดตัด ก้าวเล็กไปก็ช้าเปล่า
const TRANSIT_SPEED = {
  MC: 360, AS: 360, MO: 13.2, ME: 1.6, VE: 1.3, SU: 1.0, MA: 0.8, NO: 0.06,
  JU: 0.25, SA: 0.13, UR: 0.06, NE: 0.04, PL: 0.04,
  CU: 0.02, HA: 0.008, ZE: 0.007, KR: 0.006, AP: 0.004, AD: 0.003,
  VU: 0.002, PO: 0.002, AR: 0,
};
const TRANSIT_MAX_SAMPLES = 400000;

// ตำแหน่งของปัจจัยหนึ่งตัว ณ เวลาจริง jd
function transitFactorAt(code, jd, lat, lon) {
  if (code === "AR") return 0;
  if (code === "MC" || code === "AS") {
    const a = anglesAt(jd, lat, lon);
    return code === "MC" ? a.mc : a.asc;
  }
  return calc(code, jd);
}

function transitAspectDates(opt) {
  const codes = opt.codes;                 // ["SU"] หรือ ["MO","SA"] (ศูนย์รังสี)
  // เป้าหมายเป็นจุดคงที่ก็ได้ (target) หรือเคลื่อนที่ก็ได้ (targetAt)
  // ชั้น v1/v2 เดินตามโค้งสุริยยาตร์ ~1°/ปี ถ้าตรึงไว้จะเพี้ยนขึ้นเรื่อย ๆ
  // เมื่อสแกนยาวหลายสิบปี — ต้องคิดตามจริง
  const targetAt = typeof opt.targetAt === "function"
    ? (jd) => mod360(opt.targetAt(jd))
    : (() => { const t = mod360(opt.target); return () => t; })();
  const angle = opt.angle;
  const lat = opt.lat, lon = opt.lon;
  const jd0 = opt.jdStart, jd1 = opt.jdEnd;

  const posAt = (jd) => {
    if (codes.length === 1) return transitFactorAt(codes[0], jd, lat, lon);
    const a = transitFactorAt(codes[0], jd, lat, lon);
    const b = transitFactorAt(codes[1], jd, lat, lon);
    return mod360(a + wrapHalf(b - a, 360) / 2);   // ศูนย์รังสีแขนสั้น
  };

  let fast = 0;
  for (const c of codes) fast = Math.max(fast, TRANSIT_SPEED[c] || 0.05);
  if (fast >= 100) {
    throw new Error(
      "จุดเจ้าชะตา (MC/AS) หมุนครบวงทุกวัน — คำตอบคือ “ทุกวัน” ไม่ใช่วันใดวันหนึ่ง " +
      "ใช้โหมดโค้งสุริยยาตร์แทน หรือเลือกดาวดวงอื่น");
  }
  // ก้าวสแกน: ให้ดาวเร็วสุดขยับไม่เกิน 20° ต่อก้าว (ห่างจากขอบ 180° มาก)
  // เพดาน 4 วัน ไม่ใช่ 10 — ดาวพุธถอยหลังเป็นช่วง ~3 สัปดาห์ ถ้าก้าว 10 วัน
  // จะได้ตัวอย่างแค่ 2 จุดในช่วงนั้น เสี่ยงข้ามจุดตัดสามครั้งของการถอยหลัง
  // (ราคาถูกมาก: 120 ปี ที่ก้าว 4 วัน = ~11,000 จุด คิดเสร็จในหลักมิลลิวินาที)
  const step = Math.max(0.05, Math.min(4, 20 / fast));
  if ((jd1 - jd0) / step > TRANSIT_MAX_SAMPLES) {
    throw new Error("ช่วงเวลายาวเกินไปสำหรับดาวดวงนี้ — ลดจำนวนปีลง");
  }

  // มุม A มีสองฝั่งเสมอ (target+A และ target−A) ยกเว้น 0 กับ 180 ที่ทับกัน
  const sides = (angle > 0 && angle < 180) ? [angle, -angle] : [angle];

  const rows = [];
  for (const off of sides) {
    const tgtAt = (jd) => mod360(targetAt(jd) + off);
    let pj = jd0, pp = posAt(pj), pv = wrapHalf(pp - tgtAt(pj), 360);
    for (let jd = jd0 + step; jd <= jd1; jd += step) {
      const pnow = posAt(jd), v = wrapHalf(pnow - tgtAt(jd), 360);
      // ศูนย์รังสีของ "สองดาวที่เคลื่อนที่" กระโดด 180° ตอนดาวสองดวงผ่านจุด
      // ตรงข้ามกัน — ช่วงที่กระโดดไม่ใช่จุดตัดจริง ต้องข้าม ไม่งั้นได้วันที่มั่ว
      // (เจอจริง: ศูนย์รังสี MAt/VEt คลาดจากมุมที่ขอถึง 88°)
      const jump = Math.abs(wrapHalf(pnow - pp, 360)) > 90;
      // ข้ามการกระโดดที่ขอบ ±180 ของ wrapHalf เอง ไม่ใช่จุดตัดจริง
      if (!jump && (pv < 0) !== (v < 0) && Math.abs(pv) + Math.abs(v) < 180) {
        let lo = pj, hi = jd, flo = pv;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2, fm = wrapHalf(posAt(mid) - tgtAt(mid), 360);
          if ((flo < 0) !== (fm < 0)) hi = mid; else { lo = mid; flo = fm; }
        }
        const hit = (lo + hi) / 2, deg = posAt(hit);
        // ด่านสุดท้าย: ต้องทำมุมที่ขอจริง ๆ ไม่ใช่เชื่อว่านิวตันหาถูกเสมอ
        if (Math.abs(sepCircle(deg, targetAt(hit)) - angle) < 1e-6)
          rows.push({ jd: hit, ang: angle, deg });
      }
      pj = jd; pp = pnow; pv = v;
    }
  }
  rows.sort((a, b) => a.jd - b.jd);
  return { rows, step };
}

function formulaSolve(opt) {
  const a = evalFormulaSide(opt.sideA, opt.layers);
  const b = evalFormulaSide(opt.sideB, opt.layers);
  const pick = opt.pick === undefined ? null : opt.pick;
  const step = opt.step === undefined ? 360 : opt.step;
  const orbMax = opt.orbMax === undefined ? 1 : opt.orbMax;
  const angOn = opt.angOn || null;
  const tz = opt.tz;
  const jdBirth = opt.jdBirth, jdStart = opt.jdStart, jdEnd = opt.jdEnd;

  const sep = sepCircle(a.deg, b.deg);
  // เลือกมุมเจาะจง = วัดกับมุมนั้นตรง ๆ · ไม่เลือก = เอามุมที่ใกล้ที่สุด
  const f = pick === null ? aspectTrue(sep, !!opt.sixty)
                          : { ang: pick, orb: Math.abs(sep - pick) };
  const hit = f.orb <= orbMax;
  const same = (a.k === b.k);
  const snap = [];
  for (const sd of [opt.sideA, opt.sideB]) for (const x of sd.f)
    if (FORMULA_SNAP.indexOf(x.s) >= 0 && snap.indexOf(x.s) < 0) snap.push(x.s);

  const dk = same ? 1 : (a.k - b.k), d0 = mod360(a.base - b.base);
  const period = Math.abs(360 / dk);
  // มุมเป้าหมาย: เลือกเจาะจง = มุมนั้นทั้งสองทิศ (เช่น 45 กับ 315)
  // ไม่เลือก = ไล่ตามจานกระตุ้น 0, step, 2·step … ไม่ซ้ำ
  const tgts = [];
  if (pick !== null) {
    tgts.push(pick);
    if (pick > 0 && pick < 180) tgts.push(360 - pick);
  } else {
    for (let t = 0; t < 360 - 1e-9; t += step) {
      const fold = t > 180 ? 360 - t : t;
      if (!angOn || angOn[fold]) tgts.push(t);
    }
  }
  const rows = [];
  for (const tgt of tgts) {
    const a0 = mod360((tgt - d0) / dk);
    for (let arc = a0 % period; arc <= 360; arc += period) {
      const jd = solveArcDate(jdBirth, arc, jdBirth + arc / 0.9856 * 365.25, 360, tz);
      if (jd > jdEnd) break;
      if (jd >= jdStart) rows.push({ arc, jd, ang: tgt > 180 ? 360 - tgt : tgt });
    }
  }
  rows.sort((x, y) => x.jd - y.jd);
  return { a, b, sep, ang: f.ang, orb: f.orb, hit, same, snap, rows };
}

// ── จับกลุ่มบนจาน (พระเคราะห์สนธิ) ────────────────────────────────────────
// single-linkage: คู่ที่ห่างเกิน orb ยังนับได้ถ้ามีดาวเชื่อมเป็นลูกโซ่
function clusterOnDial(positions, dial, orb) {
  dial = dial === undefined ? DIAL_DEFAULT : dial;
  orb = orb === undefined ? 1.2 : orb;
  const items = Object.keys(positions)
    .map((k) => [k, ((positions[k] % dial) + dial) % dial])
    .sort((a, b) => a[1] - b[1]);
  const n = items.length;
  if (n < 2) return [];
  // ตัดวงกลมตรงช่องว่างกว้างสุด แล้วไล่เป็นเส้นตรง
  let start = 0, big = -1;
  for (let i = 0; i < n; i++) {
    const g = (((items[(i + 1) % n][1] - items[i][1]) % dial) + dial) % dial;
    if (g > big) { big = g; start = i; }
  }
  const order = [];
  for (let k = 0; k < n; k++) order.push(items[(start + 1 + k) % n]);
  const groups = [[order[0]]];
  for (let i = 1; i < n; i++) {
    const g = (((order[i][1] - order[i - 1][1]) % dial) + dial) % dial;
    if (g <= orb) groups[groups.length - 1].push(order[i]);
    else groups.push([order[i]]);
  }
  const out = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    let span = 0;
    for (let i = 0; i + 1 < g.length; i++) {
      span += (((g[i + 1][1] - g[i][1]) % dial) + dial) % dial;
    }
    out.push({ members: g.map((a) => a[0]),
               pos: Object.fromEntries(g), span: span });
  }
  return out;
}

// เช็ค orb "รายคู่" ไม่มีลูกโซ่ — กฎของหน้า "ตารางภาพดาว" /uranian-graph
// ต่างจาก clusterOnDial ตรงที่คู่ซึ่งห่างเกิน orb จะไม่ถูกนับ แม้มีดาวเชื่อมอยู่
// สอบเทียบกับเว็บ 5 ชุด (จาน 90/45/22.5 · orb 1/1.2/2) ตรงทุกคู่
function pairsOnDial(positions, dial, orb) {
  dial = dial === undefined ? DIAL_DEFAULT : dial;
  orb = orb === undefined ? ORB_RT : orb;
  const codes = rank(Object.keys(positions));
  const out = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const g = dialGap(positions[codes[i]], positions[codes[j]], dial);
      if (g <= orb) out.push({ a: codes[i], b: codes[j], gap: g });
    }
  }
  out.sort((p, q) => p.gap - q.gap);
  return out;
}

// ── ทุกสูตรตลอดชีวิต ──────────────────────────────────────────────────────
// ไม่ไล่ทีละเดือน แต่แก้สมการตรง: เป้าหมายของแต่ละคู่เกิดซ้ำทุก 22.5° (T2/T3)
// หรือ 11.25° (T1) โค้งเดินราว 0.9856°/ปี จึงคำนวณรอบที่เข้าช่วงได้ทันที
function lifetimeEvents(radix, jdBirth, opt) {
  opt = opt || {};
  const dial = opt.dial === undefined ? DIAL_DEFAULT : opt.dial;
  const years = opt.years === undefined ? 70.0 : opt.years;
  const kinds = opt.kinds || [1, 2, 3, 4];
  const personalOnly = !!opt.personalOnly;
  const t4Step = opt.t4Step === undefined ? 2.0 : opt.t4Step;
  const tz = opt.tz;
  const codes = rank(Object.keys(radix));
  const per = Object.keys(FACTOR_CLASS).filter((k) => FACTOR_CLASS[k] === "personal");
  const jdEnd = Math.min(_JD1, jdBirth + years * 365.2422);
  let arcMax = solarArc(jdBirth, jdEnd + arcExtraDays(jdBirth, jdEnd, tz), tz);
  if (arcMax < years * 0.5) arcMax += 360.0;   // เผื่อโค้งวนเกิน 360°
  const mod = (v, m) => ((v % m) + m) % m;
  const out = [];

  const add = (kind, lead, target, period, orb) => {
    if (personalOnly && !lead.some((c) => per.indexOf(c) >= 0)) return;
    for (let k = 0; ; k++) {
      const a = target + k * period;
      if (a > arcMax) break;
      if (a < 0) continue;
      const peak = solveArcDate(jdBirth, a, jdBirth + a / ARC_DEG_PER_DAY, 360.0, tz);
      const lo = solveArcDate(jdBirth, a - orb, peak, 360.0, tz);
      const hi = solveArcDate(jdBirth, a + orb, peak, 360.0, tz);
      if (hi < jdBirth || lo > jdEnd) continue;
      const anchor = kind === 1
        ? mod((radix[lead[0]] + radix[lead[1]]) / 2.0, dial)
        : mod(radix[lead[0]], dial);
      const nat = codes.filter((q) => lead.indexOf(q) < 0
        && dialGap(radix[q], anchor, dial) <= ORB_RT);
      out.push({ kind: kind, lead: lead, who: "โค้ง", natal: nat, transit: [],
                 start: Math.min(lo, hi), peak: peak, end: Math.max(lo, hi), arc: a });
    }
  };

  for (const x of codes) {
    for (const y of codes) {
      if (x === y) continue;
      if (kinds.indexOf(1) >= 0) {
        add(1, [x, y], mod(radix[y] - radix[x], dial) / 2.0, dial / 2.0, ORB_T1);
      }
      if (kinds.indexOf(2) >= 0) add(2, [x, y], mod(radix[x] - radix[y], dial), dial, ORB_T23);
      if (kinds.indexOf(3) >= 0) add(3, [x, y], mod(radix[y] - radix[x], dial), dial, ORB_T23);
    }
  }

  if (kinds.indexOf(4) >= 0) {
    const n = Math.floor((jdEnd - jdBirth) / t4Step) + 2;
    const jds = new Float64Array(n), grid = {};
    for (const c of MONTH_TABLE_TRANSITS) grid[c] = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const jd = Math.min(_JD1, jdBirth + i * t4Step);
      jds[i] = jd;
      for (const c of MONTH_TABLE_TRANSITS) grid[c][i] = calc(c, jd);
    }
    for (const y of codes) {
      if (personalOnly && per.indexOf(y) < 0) continue;
      for (const c of MONTH_TABLE_TRANSITS) {
        const arr = grid[c];
        let inside = null, bestG = 0, bestJd = 0;
        for (let i = 0; i < n; i++) {
          const g = dialGap(arr[i], radix[y], dial);
          if (g <= ORB_RT) {
            if (inside === null) { inside = jds[i]; bestG = g; bestJd = jds[i]; }
            else if (g < bestG) { bestG = g; bestJd = jds[i]; }
          } else if (inside !== null) {
            out.push({ kind: 4, lead: [y], who: c, natal: [], transit: [c],
                       start: inside, peak: bestJd, end: jds[i], arc: null });
            inside = null;
          }
        }
        if (inside !== null) {
          out.push({ kind: 4, lead: [y], who: c, natal: [], transit: [c],
                     start: inside, peak: bestJd, end: jds[n - 1], arc: null });
        }
      }
    }
  }
  out.sort((a, b) => a.peak - b.peak || a.kind - b.kind);
  return out;
}

function rowFactors(row) {
  const s = new Set(row.lead);
  for (const c of row.natal) s.add(c);
  for (const c of row.transit) s.add(c);
  return s;
}

// ── ข้อความแถวแบบเดียวกับปุ่ม "รหัส" บนเว็บ ────────────────────────────────
const LEAD_LAYERS = { 1: ["v1", "v2"], 2: ["r", "v1"], 3: ["r", "v2"], 4: ["r"] };

function rowText(row) {
  if (row.kind === 4) {
    return row.lead[0] + "r=" + row.transit.map((c) => c + "t").join("=");
  }
  const ab = LEAD_LAYERS[row.kind];
  const head = row.lead[0] + ab[0] + "=" + row.lead[1] + ab[1];
  const parts = row.natal.map((c) => c + "r")
    .concat(row.transit.map((c) => c + "t"));
  // ไม่มีดาวร่วมเลย -> เว็บตัดส่วนหลังเส้นแบ่งทิ้งทั้งหมด (ทุกชนิดแถว)
  if (!parts.length) return head;
  const chain = [row.kind === 1
    ? row.lead[0] + "r/" + row.lead[1] + "r"
    : row.lead[0] + "r"].concat(parts);
  return head + " | " + chain.join("=");
}

function monthSummary(rows) {
  const cls = (set) => Object.keys(FACTOR_CLASS)
    .filter((k) => FACTOR_CLASS[k] === set);
  const good = cls("good"), bad = cls("bad"), per = cls("personal");
  const out = { good_rows: 0, good_rows_personal: 0, bad_rows: 0,
                bad_rows_personal: 0, personal_rows: 0,
                good_stars: 0, bad_stars: 0 };
  for (const row of rows) {
    const f = rowFactors(row);
    const ng = good.filter((k) => f.has(k)).length;
    const nb = bad.filter((k) => f.has(k)).length;
    const hasP = per.some((k) => f.has(k));
    if (ng) { out.good_rows++; if (hasP) out.good_rows_personal++; }
    if (nb) { out.bad_rows++; if (hasP) out.bad_rows_personal++; }
    if (hasP) out.personal_rows++;
    out.good_stars += ng;
    out.bad_stars += nb;
  }
  return out;
}

// ── export ─────────────────────────────────────────────────────────────────

// ── แกน A, A/B (สูตรภาพดาวรอบแกนหนึ่งดวง) ─────────────────────────────────
// กติกาถอดจากเว็บ แผง "แกน=A,A/B" — สอบเทียบ 11 แกน / 10 ดวงเกิด
// (test_axis_site.js): [A] 81 แถว · [A/B] 237 คู่ · อายุโค้ง 237 คู่ ตรงหมด
//   A   = ดาวเดี่ยวชั้น r,v1,v2,t ทำมุมพหุคูณ 22.5° กับแกน (orb ≤ 1)
//         ป้ายมุม: 0/180/90 ตามจริง · 45 รวม 135 · 22.5 รวม 67.5/112.5/157.5
//         ตัด: ตัวแกนเองชั้นเดียวกัน และ AR ชั้น t (ตำแหน่งซ้ำ AR ชั้น r)
//   A/B = ศูนย์รังสีคู่ดาวชั้น r "จุดกึ่งกลางแขนสั้น" ตกแกน (orb ≤ 1)
//         อายุโค้ง: h = ครึ่งระยะแยกสั้น (≤90°) · แสดง h, 360-h, A-B, B-A

function sepCircle(a, b) {
  const d = Math.abs(mod360(a - b));
  return Math.min(d, 360 - d);
}

// จำแนกตระกูลมุมจากชุด {0,180,90,45,22.5} — คืน {ang, orb}
function aspect225(sep) {
  const cand = [[0, 0], [180, 180], [90, 90], [45, 45], [135, 45],
                [22.5, 22.5], [67.5, 22.5], [112.5, 22.5], [157.5, 22.5]];
  let best = null;
  for (const [m, fam] of cand) {
    const d = Math.abs(sep - m);
    if (best === null || d < best.orb) best = { orb: d, ang: fam };
  }
  return best;
}

// ลำดับชั้นสำหรับจัดเรียงรายการในแผงแกน (ชั้นที่ไม่อยู่ในรายการไปท้ายสุด)
const LAYER_RANK = ["r", "p", "tp1", "tp2", "v1", "v2", "l1", "l2", "t"];
function layRank(s) {
  const i = LAYER_RANK.indexOf(s);
  return i < 0 ? LAYER_RANK.length : i;
}

// ── ป้ายมุมจริง + ลำดับความสำคัญ (ใช้แสดงผล ไม่ใช่ตัวเทียบเว็บ) ──────────
// aspect225() ข้างบนพับป้าย (45 กลืน 135 · 22.5 กลืน 67.5/112.5/157.5) ตามเว็บ
// ส่วนนี้คืนป้ายมุมจริง — **จุดมุมชุดเดียวกันเป๊ะ** orb จึงเท่ากันทุกแถว
// ต่างแค่ชื่อมุม ไม่มีแถวเพิ่มหรือหาย (ยกเว้นเปิด 60° ซึ่งเพิ่มจุดใหม่)
const ASPECT_ORDER = [0, 180, 90, 45, 135, 22.5, 67.5, 112.5, 157.5, 60];
function aspectRank(ang) {
  const i = ASPECT_ORDER.indexOf(ang);
  return i < 0 ? ASPECT_ORDER.length : i;
}
// ลำดับใน ASPECT_PTS ต้องตรงกับลำดับใน aspect225() เพราะทั้งคู่ตัดสินเสมอ
// ด้วย "ตัวแรกที่เจอ" — ถ้าเรียงต่างกัน จุดกึ่งกลางพอดี (เช่น sep 33.75 ที่
// ห่าง 22.5 กับ 45 เท่ากัน) จะได้คนละป้าย · จุดพวกนี้ orb 11.25° ไม่เคยแสดงจริง
// แต่ให้ตรงกันไว้ดีกว่า จะได้พับป้ายกลับเป็นแบบเว็บได้เสมอ
const ASPECT_PTS = [0, 180, 90, 45, 135, 22.5, 67.5, 112.5, 157.5];
// sixty = true → เพิ่มจุด 60° (สาย 3 วิทเทอไม่ใช้ แต่เว็บมีให้ติ๊ก)
// เป็นการ "เพิ่มแถว" ล้วน — แถวเดิมไม่เปลี่ยน เพราะ sep ที่ใกล้ 60 กว่า 45/67.5
// ย่อมห่างจาก 45/67.5 เกิน 3.75° อยู่แล้ว จึงไม่เคยติด orb ≤1 มาก่อน
function aspectTrue(sep, sixty) {
  const cand = sixty ? ASPECT_PTS.concat([60]) : ASPECT_PTS;
  let best = null;
  for (const m of cand) {
    const d = Math.abs(sep - m);
    if (best === null || d < best.orb) best = { orb: d, ang: m };
  }
  return best;
}

// จุดกึ่งกลางจริง (ขั้วบนแขนสั้นระหว่างสองดาว)
function midpointShort(a, b) {
  const m = mod360((a + b) / 2);
  return sepCircle(m, a) <= 90 ? m : mod360(m + 180);
}

// รับ "แกน" ได้ 2 แบบ — คืน {deg, lab, src} เสมอ
//   แบบดาว : axLab="MO", axSrc="r"      → ตัดตัวเองออกจากรายการ [A]
//   แบบองศา: axLab=<number> (axSrc ว่าง) → ไม่ตัดอะไร ดาวที่ทับแกนจะขึ้น orb 0
// (พฤติกรรมนี้ถอดจากโหมด Deg ของเว็บ — export_axis/site_axis_12_DEG.json)
function resolveAxis(layers, axLab, axSrc) {
  if (typeof axLab === "number")
    return { deg: mod360(axLab), lab: null, src: null };
  return { deg: layers[axSrc][axLab], lab: axLab, src: axSrc };
}

// layers = {r:{...}, v1:{...}, v2:{...}, t:{...}} จาก layerPositions
// axLab+axSrc = ดาวแกน เช่น ("MO","r") หรือองศาดิบ เช่น (14.1189)
function axisPictures(layers, axLab, axSrc, opt) {
  opt = opt || {};
  const orbA = opt.orbA === undefined ? 1.0 : opt.orbA;
  const orbAB = opt.orbAB === undefined ? 1.0 : opt.orbAB;
  const laysA = opt.layersA || ["r", "v1", "v2", "t"];
  const laysAB = opt.layersAB || ["r"];
  // ค่าปริยายต้องเป็นแบบเว็บเสมอ (fixture ทั้งหมดยึดค่าปริยาย)
  // UI เป็นฝ่ายเปิด trueAngle/sixty/byAspect เอง
  const asp = opt.trueAngle ? (v) => aspectTrue(v, opt.sixty) : aspect225;
  const AX = resolveAxis(layers, axLab, axSrc);
  const axis = AX.deg;

  const A = [];
  // AR อยู่ที่ 0° เท่ากันทุกชั้นที่คำนวณดวงใหม่ (r/p/tp1/tp2/t) ส่วน v1/v2/l1/l2
  // เลื่อนตามโค้ง · เว็บแสดง AR ที่องศาซ้ำกัน "ตัวเดียว" คือชั้นแรกที่ยังไม่ถูกตัด
  // ถ้า ARr เป็นแกนเอง (โดนกฎแกนตัดตัวเอง) เว็บจะเลื่อน ARt ขึ้นมาแทน
  // สอบเทียบ: export_axis/site_axis_10_URr (แสดง ARr ไม่แสดง ARt) และ
  //           export_axis_v/site50_hash.txt #0 แกน ARr (แสดง ARt)
  // ต้องเป็น "ทุกองศาที่แสดงไปแล้ว" ไม่ใช่ตัวล่าสุด — ชั้น l1/l2 มี AR คนละองศา
  // ถ้าเก็บแค่ตัวล่าสุด ARl1 จะไปทับค่า ARr แล้ว ARt หลุดออกมาซ้ำ
  const arShown = [];
  for (const s of laysA) {
    if (!layers[s]) continue;
    for (const p in layers[s]) {
      if (s === AX.src && p === AX.lab) continue;
      if (p === "AR" && arShown.some((d) => sepCircle(layers[s][p], d) < 1e-9)) continue;
      const f = asp(sepCircle(layers[s][p], axis));
      if (f.orb <= orbA) {
        A.push({ p, src: s, ang: f.ang, orb: f.orb });
        if (p === "AR") arShown.push(layers[s][p]);
      }
    }
  }
  A.sort((x, y) => x.p < y.p ? -1 : x.p > y.p ? 1 :
                   x.src < y.src ? -1 : x.src > y.src ? 1 : 0);

  const AB = [];
  for (const s of laysAB) {
    if (!layers[s]) continue;
    const codes = Object.keys(layers[s]);
    for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
      const f = asp(sepCircle(midpointShort(layers[s][codes[i]], layers[s][codes[j]]), axis));
      if (f.orb > orbAB) continue;
      // ลำดับในคู่ตาม CODE_ORDER (เหมือนเว็บ)
      let a = codes[i], b = codes[j];
      if (CODE_ORDER.indexOf(a) > CODE_ORDER.indexOf(b)) { const t = a; a = b; b = t; }
      const h = sepCircle(layers[s][a], layers[s][b]) / 2;
      AB.push({ a, b, src: s, ang: f.ang, orb: f.orb,
                half: h, halfNeg: 360 - h,
                amb: mod360(layers[s][a] - layers[s][b]),
                bma: mod360(layers[s][b] - layers[s][a]) });
    }
  }
  // byAspect = เรียงตามความสำคัญของมุมก่อน แล้วค่อย orb แคบสุด (ใช้ใน UI)
  // ค่าปริยาย = เรียงตามชื่อดาวแบบเว็บ (fixture ยึดแบบนี้)
  AB.sort(opt.byAspect
    ? (x, y) => aspectRank(x.ang) - aspectRank(y.ang) || x.orb - y.orb ||
                layRank(x.src) - layRank(y.src) ||
                (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0)
    : (x, y) => x.a < y.a ? -1 : x.a > y.a ? 1 :
                x.b < y.b ? -1 : x.b > y.b ? 1 :
                layRank(x.src) - layRank(y.src));
  return { axis: mod360(axis), lab: AX.lab, src: AX.src, A, AB };
}


// สูตรสามดาว A+B−C ตกแกน (พระเคราะห์สนธิ 4 ปัจจัย: A+B = C+แกน)
// สอบเทียบเลข A+B−C กับโหมดตั้งแกน "A+B-C" ของเว็บ 12 สูตร ตรงทุกค่า
// (export_axis/site_sum_11_ABC.json — เว็บแสดงองศาช้าไป 1 จังหวะ เลื่อนกลับแล้ว)
// นับเฉพาะมุมกุม 0° บนวงกลม 360 (แบบเดียวกับที่โปรแกรมยูเรเนียนสากลแสดง)
// ตัด: C ซ้ำกับ A หรือ B (ยุบเหลือดาวเดี่ยว = อยู่ในรายการ A แล้ว)
//      และ A ซ้ำ B (เป็นสูตร A+A−B คนละโหมด)
// opt.layer = ชั้นเดียว (ค่าเดิม "r") · opt.layers = หลายชั้น เช่น ["r","v1","v2"]
// v1/v2 คือดวงเดิมหมุนไป ±โค้งสุริยยาตร ระยะห่างระหว่างดาวจึงเท่าดวงเดิม
// สูตรจึงเป็นชุดเดียวกันแต่เลื่อนองศา — ที่ตกแกนตอนนี้จึงต่างกันจริง
function sumPictures(layers, axLab, axSrc, opt) {
  opt = opt || {};
  const orb = opt.orb === undefined ? 1.0 : opt.orb;
  const lays = opt.layers || [opt.layer || "r"];
  const axis = resolveAxis(layers, axLab, axSrc).deg;
  const out = [];
  for (const lay of lays) {
    const P = layers[lay];
    if (!P) continue;
    const codes = CODE_ORDER.filter((c) => c in P);
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        for (let k = 0; k < codes.length; k++) {
          const a = codes[i], b = codes[j], c = codes[k];
          if (c === a || c === b) continue;
          const d = Math.abs(mod360(P[a] + P[b] - P[c] - axis));
          const g = Math.min(d, 360 - d);
          if (g <= orb) out.push({ a, b, c, src: lay, orb: g,
                                   deg: mod360(P[a] + P[b] - P[c]) });
        }
      }
    }
  }
  out.sort((x, y) => x.orb - y.orb || layRank(x.src) - layRank(y.src));
  return out;
}


// ── พจนานุกรมผสมดาว (คำแปลจากเว็บ ไม่ใช่การตีความเอง) ─────────────────────
// โหลดจาก dict.json.gz เมื่อผู้ใช้กดขอคำแปลครั้งแรก (ไฟล์ 0.3 MB)
//   two[A.B]      = คำแปล 2 ดาว แยก 4 บริบท (person/country/company/stock)
//   witte[A.B]    = ภาษาตำราวิทเทอดั้งเดิม
//   three[A.B.C]  = คำแปล 3 ดาว — คู่ (A,B) เรียงตาม CODE_ORDER ส่วน C คือตัวที่ศูนย์รังสีตก
//                   **ลำดับมีผล**: A/B=C ต่างจาก A/C=B (ดู _meta.three_order)
let _DICT = null;
function dictKey2(a, b) {
  const ia = CODE_ORDER.indexOf(a), ib = CODE_ORDER.indexOf(b);
  return ia <= ib ? a + "." + b : b + "." + a;
}
function initDict(obj) { _DICT = obj; return dictInfo(); }
function dictInfo() {
  return _DICT ? { ready: true, two: Object.keys(_DICT.two).length,
                   three: Object.keys(_DICT.three).length, meta: _DICT._meta }
               : { ready: false };
}
async function loadDict(url) {
  if (_DICT) return dictInfo();
  const res = await fetch(url);
  if (!res.ok) throw new Error("โหลดพจนานุกรมไม่ได้: HTTP " + res.status);
  let txt;
  // เช็คนามสกุลจาก **path เท่านั้น** — ถ้าเทียบทั้ง URL แล้วมี ?retry= ต่อท้าย
  // (ปุ่ม "ลองใหม่" ใส่ให้เพื่อเลี่ยงแคช) `/\.gz$/` จะไม่ตรง แล้วข้าม gunzip ไป
  // JSON.parse ได้ไบต์ gzip ดิบ → "Unexpected token '\u001f'" (0x1F = magic byte)
  const path = String(url).split(/[?#]/)[0];
  if (/\.gz$/.test(path) && typeof DecompressionStream === "function") {
    const ds = new DecompressionStream("gzip");
    txt = await new Response(res.body.pipeThrough(ds)).text();
  } else {
    txt = await res.text();
  }
  return initDict(JSON.parse(txt));
}

// คำแปลของแถวในแผงแกน — คืน {kind, key, text, witte, parts} หรือ {kind:"none"}
// ctx = person | country | company | stock
function lookupMeaning(row, ctx) {
  if (!_DICT) return { kind: "notloaded" };
  ctx = ctx || "person";
  const pick = (o) => o && (o[ctx] || o.person || null);
  if (row.type === "A") {                       // 1 ดาว: ดาว + แกน = คู่ 2 ดาว
    const k = dictKey2(row.p, row.axis);
    return { kind: "two", key: k, text: pick(_DICT.two[k]), witte: _DICT.witte[k] || null };
  }
  if (row.type === "AB") {                      // 2 ดาว: ศูนย์รังสี A/B ตกแกน = 3 ดาว
    const k = dictKey2(row.a, row.b) + "." + row.axis;
    return { kind: "three", key: k, text: _DICT.three[k] || null };
  }
  if (row.type === "ABC") {
    // หลักการแปลของผู้ใช้ (RULES.md ข้อ 0, 5 ก.ย. 2026):
    // A+B−C แปลเหมือน A=B=C = คีย์สามปัจจัย "ศูนย์รังสี A/B ตกแกน C"
    // (คู่ที่บวกกันเป็นฝั่งศูนย์รังสี ตัวที่ลบเป็นฝั่งแกน) — คีย์ชุดเดียว
    // กับ type "AB" จึงไม่ใช่การแต่งคำแปลใหม่
    const k = dictKey2(row.a, row.b) + "." + row.c;
    return { kind: "three", via: "abc", key: k, text: _DICT.three[k] || null };
  }
  return { kind: "none" };
}

// ค้นพจนานุกรมด้วยคีย์เวิร์ด — คืนทุกสมการที่คำแปลมีคำนั้น
// (ฟีเจอร์ UI ล้วน ไม่แตะการคำนวณ · ผู้ใช้ขอ 31 ส.ค. 2026)
function dictSearch(q, ctx) {
  if (!_DICT) return { ready: false, two: [], three: [] };
  ctx = ctx || "person";
  q = String(q || "").trim();
  const out = { ready: true, two: [], three: [] };
  if (!q) return out;
  for (const k in _DICT.two) {
    const o = _DICT.two[k];
    const t = (o && (o[ctx] || o.person)) || "";
    const w = _DICT.witte[k] || "";
    if (t.indexOf(q) >= 0 || w.indexOf(q) >= 0)
      out.two.push({ key: k, text: t || null, witte: w || null });
  }
  for (const k in _DICT.three) {
    const t = _DICT.three[k];
    if (t && t.indexOf(q) >= 0) out.three.push({ key: k, text: t });
  }
  return out;
}

const AISTRO = {
  calc, calcRaw, obliquity, julday, revjul, anglesAt, mod360, assertRange,
  get JD_MIN() { return _JD0; }, get JD_MAX() { return _JD1; },
  buildRadix, chartAt, layerPositions, elapsedYears, progressedJd,
  tertiary1Jd, minorJd, solarArc, lunarArc, leapBirthExtraDays, arcExtraDays,
  monthTable, monthSummary, rowText, rowFactors,
  transitAspectDates, transitFactorAt, TRANSIT_SPEED,
  activationDates, transitWindows, solveArcDate, radiationRows, dictSearch,
  FORMULA_K, FORMULA_SNAP, parseFormulaSide, evalFormulaSide, formulaSolve,
  loadEphem, initEphemBinary, initEphemJs,
  lifetimeEvents, clusterOnDial, pairsOnDial,
  axisPictures, sumPictures, resolveAxis, aspect225, aspectTrue, aspectRank,
  ASPECT_ORDER, midpointShort, sepCircle,
  loadDict, initDict, dictInfo, lookupMeaning, dictKey2,
  CODE_ORDER, FACTOR_CLASS, MONTH_TABLE_TRANSITS,
  DIAL_DEFAULT, ORB_RT, SIDEREAL_YEAR, TROPICAL_MONTH,
};
if (typeof module !== "undefined") module.exports = AISTRO;
if (typeof globalThis !== "undefined") globalThis.AISTRO = AISTRO;
