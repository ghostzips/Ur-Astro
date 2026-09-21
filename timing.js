/* timing.js — จังหวะเวลา (พอร์ตตรงจาก ui/server.py: aspect_windows · _sample_times · _edge/_edges ·
 * _refine_min · _line_km_at · _line_spans · _overlap · _timing · when_where)
 *
 * ทุกกติกาที่แก้ไปตามผลรีวิว (จุดปลายช่วง · ขอบเข้า-ออกจริง · ★ เทียบเวลาจริง) ต้องอยู่ครบเหมือน Python
 * ตรวจค่าต่อค่าใน selftest.html
 */
(function (root) {
  "use strict";
  const ASPECTS = [0, 90, 180];
  const ASPECT_TH = { 0: "ร่วม (conjunction)", 90: "จัตุรัส (square)", 180: "ตรงข้าม (opposition)" };
  const ASPECT_ORB = 1.0;
  const STEP = { transit: 0.25, progressed: 1.0 };
  const ANGLES = ["MC", "IC", "AC", "DC"];
  const mod360 = (v) => ((v % 360) + 360) % 360;
  const lonOf = (jd, code) => root.AISTRO.calc(root.ACG.LON_ALIAS[code] || code, jd);

  function ymd(jd) {
    const [y, m, d] = root.AISTRO.revjul(jd);
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  /** เวลาที่ไล่ดู: jd_a, +step, … และจุดปลายช่วง (24:00 ของวันจบ ลบ ε) เสมอ */
  function sampleTimes(jdA, days, step) {
    const n = Math.floor(days / step), ts = [];
    for (let i = 0; i < n; i++) ts.push(jdA + i * step);
    const tEnd = jdA + days - 1e-6;
    if (!ts.length || tEnd - ts[ts.length - 1] > 1e-9) ts.push(tEnd);
    return ts;
  }
  function edge(inside, tOut, tIn, iters) {
    iters = iters || 30;
    for (let i = 0; i < iters; i++) {
      const m = (tOut + tIn) / 2;
      if (inside(m)) tIn = m; else tOut = m;
    }
    return tIn;
  }
  function edges(r, ts, inside) {
    const tIn = r.first_i === 0 ? ts[0] : edge(inside, ts[r.first_i - 1], ts[r.first_i]);
    const tOut = r.last_i === ts.length - 1 ? ts[ts.length - 1] : edge(inside, ts[r.last_i + 1], ts[r.last_i]);
    return [tIn, tOut];
  }
  const overlap = (w, a) => w.kind === a.kind && w.jd_in <= a.jd_out && a.jd_in <= w.jd_out;
  function refineMin(f, a, b, iters) {
    iters = iters || 40;
    for (let i = 0; i < iters; i++) {
      const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
      if (f(m1) <= f(m2)) b = m2; else a = m1;
    }
    const x = (a + b) / 2;
    return [x, f(x)];
  }
  function lineKmAt(jdB, kind, code, angle, lat, lon, method) {
    return (t) => {
      const v = (kind === "transit" ? root.ACG.transitLines(jdB, t, [code], method)
                                    : root.ACG.progressedLines(jdB, t, [code], method))[code];
      return root.ACG.distanceKm(lat, lon, angle, v.ra, v.dec, v.gast);
    };
  }

  /** ช่วงที่ดาวจร/โปรเกรสทำมุม 0/90/180 กับตัวเองในดวงกำเนิด ภายใน orb */
  function aspectWindows(jdB, jdA, days, code, kind, orb) {
    orb = orb === undefined ? ASPECT_ORB : orb;
    const natal = lonOf(jdB, code);
    const step = kind === "transit" ? (code === "MO" ? 1 / 24 : 0.25) : 1.0;
    const offAt = (asp) => (t) => {
      const jp = kind === "transit" ? t : root.ACG.progressedJd(jdB, t);
      const d = mod360(lonOf(jp, code) - natal);
      return asp ? Math.min(Math.abs(d - asp), Math.abs(d - mod360(360 - asp))) : Math.min(d, 360 - d);
    };
    const runs = {}, out = [];
    const ts = sampleTimes(jdA, days, step);
    for (let i = 0; i < ts.length; i++) {
      for (const asp of ASPECTS) {
        const off = offAt(asp)(ts[i]);
        const cur = runs[asp];
        if (off <= orb) {
          if (cur && cur.last_i === i - 1) {
            cur.last_i = i;
            if (off < cur.off) { cur.off = off; cur.exact = ts[i]; }
          } else {
            if (cur) out.push([asp, cur]);
            runs[asp] = { first_i: i, last_i: i, off, exact: ts[i] };
          }
        } else if (cur && cur.last_i < i - 1) {
          out.push([asp, cur]);
          delete runs[asp];
        }
      }
    }
    for (const asp of ASPECTS) if (runs[asp]) out.push([asp, runs[asp]]);
    const rows = [];
    for (const [asp, r] of out) {
      const f = offAt(asp);
      const [tIn, tOut] = edges(r, ts, (t) => f(t) <= orb);
      const [ex, off] = refineMin(f, Math.max(tIn, r.exact - step), Math.min(tOut, r.exact + step));
      rows.push({ kind, aspect: asp, aspect_th: ASPECT_TH[asp], from: ymd(tIn), to: ymd(tOut),
                  jd_in: tIn, jd_out: tOut, exact_date: ymd(ex), off_deg: Math.round(off * 100) / 100,
                  hours: Math.round((tOut - tIn) * 24 * 10) / 10 });
    }
    return rows.sort((x, y) => x.from < y.from ? -1 : x.from > y.from ? 1 : 0);
  }

  /** ช่วงที่เส้นจร/โปรเกรสแต่ละเส้นอยู่ในระยะเมือง — ตรง _line_spans */
  function lineSpans(jdB, lat, lon, method, orbKm, jdA, days, kinds, enrich, names) {
    const spans = {};
    for (const kind of kinds) {
      const step = STEP[kind], runs = {}, done = [];
      const ts = sampleTimes(jdA, days, step);
      for (let i = 0; i < ts.length; i++) {
        const jd = ts[i];
        const sets = kind === "transit" ? root.ACG.transitLines(jdB, jd, names.bodies, method)
                                        : root.ACG.progressedLines(jdB, jd, names.bodies, method);
        for (const h of root.ACG.linesNear(lat, lon, sets, orbKm)) {
          const key = h.body + "|" + h.angle, cur = runs[key];
          if (cur && cur.last_i === i - 1) {
            cur.last_i = i; cur.n++;
            if (h.km < cur.km) { cur.km = h.km; cur.peak = jd; }
          } else {
            if (cur) done.push([key, cur]);
            runs[key] = { first_i: i, last_i: i, n: 1, km: h.km, peak: jd };
          }
        }
      }
      for (const key in runs) done.push([key, runs[key]]);
      const out = [];
      for (const [key, r] of done) {
        const [code, angle] = key.split("|");
        const kmAt = lineKmAt(jdB, kind, code, angle, lat, lon, method);
        const [tIn, tOut] = edges(r, ts, (t) => kmAt(t) <= orbKm);
        const [pk, km] = refineMin(kmAt, Math.max(tIn, r.peak - step), Math.min(tOut, r.peak + step));
        const hours = (tOut - tIn) * 24;
        out.push({ body: code, angle, th: names.th[code], glyph: names.glyph[code], kind,
                   from: ymd(tIn), to: ymd(tOut), jd_in: tIn, jd_out: tOut,
                   hours: Math.round(hours * 10) / 10, days: Math.max(1, Math.round(hours / 24)),
                   closest_date: ymd(pk), closest_km: km, ...enrich(code, angle) });
      }
      spans[kind] = out.sort((x, y) => x.from < y.from ? -1 : x.from > y.from ? 1 : x.closest_km - y.closest_km);
    }
    return spans;
  }

  /** จังหวะเวลาที่เมืองปลายทาง — ตรง _timing */
  function timing(jdB, lat, lon, method, orbKm, jdA, days, kinds, kept, enrich, names, timingAdvice) {
    const spans = lineSpans(jdB, lat, lon, method, orbKm, jdA, days, kinds, enrich, names);
    const natalLines = [];
    for (const h of kept) {
      const code = h.body;
      if (!names.bodies.includes(code)) {
        natalLines.push({ body: code, angle: h.angle, th: h.th, glyph: h.glyph, km: h.km, tnp: h.tnp || null,
                          aspects: [], windows: [], best: [], no_timing: true });
        continue;
      }
      const wins = [], asps = [];
      for (const k of kinds) for (const w of (spans[k] || [])) if (w.body === code) wins.push(w);
      for (const k of kinds) asps.push(...aspectWindows(jdB, jdA, days, code, k));
      const best = [];
      for (const w of wins) for (const a of asps) if (overlap(w, a)) best.push({ line: w, aspect: a });
      natalLines.push({ body: code, angle: h.angle, th: h.th, glyph: h.glyph, km: h.km,
                        reading: h.reading, aspects: asps, windows: wins, best });
    }
    return { spans, natal_lines: natalLines, aspect_orb: ASPECT_ORB, full_mi: 150.0, mid_mi: 300.0,
             timing_advice: timingAdvice.filter((x) => x.cites && x.cites.length).slice(0, 6) };
  }

  root.TIMING = { ASPECTS, ASPECT_TH, ASPECT_ORB, STEP, ANGLES, ymd, sampleTimes, edge, edges, overlap,
                  refineMin, lineKmAt, aspectWindows, lineSpans, timing };
})(typeof globalThis !== "undefined" ? globalThis : this);
