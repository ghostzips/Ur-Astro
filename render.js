/* render.js — เรนเดอร์ผล monthTable ให้หน้าตาเหมือนตารางบนเว็บ AISTRO
 * พอร์ตจาก src/aistro_render.py (สอบเทียบตัวอักษรต่อตัวอักษรแล้ว)
 * ส่วนนี้เป็นแค่การแสดงผล — ตัวเลขทั้งหมดมาจาก engine.js */
"use strict";
(function () {

const TYPE_TITLE = { 1: "TYPE 1", 2: "TYPE 2", 3: "TYPE 3", 4: "TYPE 4" };
const TYPE_NOTE = { 1: "การกระตุ้นหลัก · v1 = v2", 2: "ดาวกำเนิด = v1",
                    3: "ดาวกำเนิด = v2", 4: "ดาวกำเนิด = ดาวจร" };
const MONTH_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม",
  "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน",
  "ธันวาคม"];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const codeHtml = (c) =>
  `<b class="f-${AISTRO.FACTOR_CLASS[c] || "neutral"}">${esc(c)}</b>`;
const layHtml = (t) => `<i>${esc(t)}</i>`;
const sepHtml = (t) => `<u>${esc(t)}</u>`;

const LEAD_LAYERS = { 1: ["v1", "v2"], 2: ["r", "v1"], 3: ["r", "v2"] };

function rowHtml(row) {
  const out = [];
  if (row.kind === 4) {
    out.push(codeHtml(row.lead[0]) + layHtml("r"));
    for (const c of row.transit) out.push(sepHtml("=") + codeHtml(c) + layHtml("t"));
    return out.join("");
  }
  const ab = LEAD_LAYERS[row.kind];
  out.push(codeHtml(row.lead[0]) + layHtml(ab[0]) + sepHtml("=")
    + codeHtml(row.lead[1]) + layHtml(ab[1]));
  const parts = row.natal.map((c) => [c, "r"])
    .concat(row.transit.map((c) => [c, "t"]));
  if (!parts.length) return out.join("");
  const chain = [row.kind === 1
    ? codeHtml(row.lead[0]) + layHtml("r") + sepHtml("/")
      + codeHtml(row.lead[1]) + layHtml("r")
    : codeHtml(row.lead[0]) + layHtml("r")];
  for (const [c, lay] of parts) chain.push(sepHtml("=") + codeHtml(c) + layHtml(lay));
  out.push(sepHtml(" | ") + chain.join(""));
  return out.join("");
}

function rowFlags(row) {
  const f = AISTRO.rowFactors(row);
  const has = (cls) => Object.keys(AISTRO.FACTOR_CLASS)
    .some((k) => AISTRO.FACTOR_CLASS[k] === cls && f.has(k));
  const flags = ["t" + row.kind];
  if (has("good")) flags.push("has-good");
  if (has("bad")) flags.push("has-bad");
  if (has("personal")) flags.push("has-per");
  return flags.join(" ");
}

function monthColumnHtml(rows, year, month, mi) {
  const s = AISTRO.monthSummary(rows);
  const net = s.good_rows - s.bad_rows;
  const netCls = net > 0 ? "pos" : (net < 0 ? "neg" : "zero");
  const netTxt = (net >= 0 ? "+" : "") + net;
  let head =
    `<div class="mhead"><div class="mname">${MONTH_TH[month - 1]} ` +
    `<span class="yr">${year + 543}</span>` +
    `<span class="net ${netCls}">${netTxt}</span></div>` +
    `<div class="sline g">🟢 ดี: <b>${s.good_rows}</b>` +
    `<span class="pp">(🔵 ถึงเจ้าชะตา: ${s.good_rows_personal})</span></div>` +
    `<div class="sline r">🔴 ร้าย: <b>${s.bad_rows}</b>` +
    `<span class="pp">(🔵 ถึงเจ้าชะตา: ${s.bad_rows_personal})</span></div>` +
    `<div class="sline p">🔵 มีจุดเจ้าชะตาทั้งหมด: <b>${s.personal_rows}</b></div>` +
    `<div class="sline m">จำนวนดาวในทุกแถว: ` +
    `<span class="g">🟢 ${s.good_stars}</span> ` +
    `<span class="r">🔴 ${s.bad_stars}</span></div></div>`;
  const body = [];
  for (const kind of [1, 2, 3, 4]) {
    const sel = rows.filter((r) => r.kind === kind);
    if (!sel.length) continue;
    // เดิมเป็น "=== TYPE 1 ===" แบบ ASCII — เปลี่ยนเป็นหัวข้อจริงที่ CSS
    // ตีเส้นให้เอง พร้อมจำนวนแถวของชนิดนั้น (อ่านสัดส่วนได้ทันทีไม่ต้องนับ)
    body.push(`<div class="tsec" data-t="t${kind}">` +
      `<div class="thead"><b class="tt">${TYPE_TITLE[kind]}</b>` +
      `<b class="tn">${sel.length}</b>` +
      `<span>${TYPE_NOTE[kind]}</span></div>`);
    for (const r of sel) {
      // data-i = ดัชนีในอาร์เรย์ของเดือนนั้น ใช้ย้อนกลับไปหาอ็อบเจกต์แถวตอนกดดูคำแปล
      body.push(`<div class="frow ${rowFlags(r)}" data-i="${rows.indexOf(r)}">` +
        `${rowHtml(r)}</div>`);
    }
    body.push("</div>");
  }
  return `<div class="mcol"${mi === undefined ? "" : ` data-m="${mi}"`}>` +
    `${head}<div class="mbody">${body.join("")}</div></div>`;
}

globalThis.AISTRO_RENDER = { rowHtml, rowFlags, monthColumnHtml, MONTH_TH, esc };
})();
