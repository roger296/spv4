/**
 * PDF documents: the courier label placed on the account's stationery, the packing note,
 * the customs invoice, and combined print sets. pdf-lib only; fonts are the standard 14.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import bwipjs from 'bwip-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env.js';

export type Stationery = 'LABEL_6X4' | 'LABEL_4X4' | 'A4_LEFT' | 'A4_RIGHT';

const PT_PER_MM = 72 / 25.4;
const PAGE: Record<Stationery, [number, number]> = {
  LABEL_6X4: [102 * PT_PER_MM, 152 * PT_PER_MM], // portrait 4x6
  LABEL_4X4: [102 * PT_PER_MM, 102 * PT_PER_MM],
  A4_LEFT: [210 * PT_PER_MM, 297 * PT_PER_MM],
  A4_RIGHT: [210 * PT_PER_MM, 297 * PT_PER_MM],
};

export interface A4LabelArea { x: number; y: number; width: number; height: number } // mm from top-left

const DEFAULT_A4_AREA: Record<'A4_LEFT' | 'A4_RIGHT', A4LabelArea> = {
  A4_LEFT: { x: 8, y: 8, width: 99, height: 140 },
  A4_RIGHT: { x: 103, y: 8, width: 99, height: 140 },
};

export function documentsDir(): string {
  return resolve(getEnv().DOCUMENTS_DIR);
}

export async function saveDocument(accountId: string, bytes: Uint8Array, ext = 'pdf'): Promise<{ filePath: string; bytes: number }> {
  const dir = join(documentsDir(), accountId);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, name), bytes);
  return { filePath: `${accountId}/${name}`, bytes: bytes.length };
}

export async function readDocument(filePath: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|zpl)$/i.test(filePath)) throw new Error('Refusing to read a document path outside the store');
  return readFile(join(documentsDir(), filePath));
}

/** Fit a source page into a rectangle, keeping aspect ratio, centred. */
async function placePage(target: PDFDocument, page: PDFPage, src: PDFDocument, srcIndex: number, box: { x: number; y: number; w: number; h: number }, rotateToFit = true) {
  const [embedded] = await target.embedPdf(src, [srcIndex]);
  const e = embedded!;
  let sw = e.width, sh = e.height;
  let rotate = 0;
  if (rotateToFit) {
    const upright = Math.min(box.w / sw, box.h / sh);
    const turned = Math.min(box.w / sh, box.h / sw);
    if (turned > upright * 1.05) { rotate = 90; [sw, sh] = [sh, sw]; }
  }
  const scale = Math.min(box.w / sw, box.h / sh);
  const w = sw * scale, h = sh * scale;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  if (rotate === 90) page.drawPage(e, { x: x + w, y, width: h, height: w, rotate: { type: 'degrees', angle: 90 } as never });
  else page.drawPage(e, { x, y, width: w, height: h });
}

/** Render a courier label (PDF or PNG bytes) onto the chosen stationery. Returns one page per label page. */
export async function renderLabelOnStationery(label: Uint8Array, format: 'pdf' | 'png', stationery: Stationery, a4Area?: A4LabelArea): Promise<{ pdf: Uint8Array; pages: number }> {
  const out = await PDFDocument.create();
  const [pw, ph] = PAGE[stationery];
  const pageCount = format === 'pdf' ? (await PDFDocument.load(label)).getPageCount() : 1;
  const src = format === 'pdf' ? await PDFDocument.load(label) : null;
  for (let i = 0; i < pageCount; i++) {
    const page = out.addPage([pw, ph]);
    let box = { x: 0, y: 0, w: pw, h: ph };
    if (stationery === 'A4_LEFT' || stationery === 'A4_RIGHT') {
      const area = a4Area ?? DEFAULT_A4_AREA[stationery];
      box = { x: area.x * PT_PER_MM, y: ph - (area.y + area.height) * PT_PER_MM, w: area.width * PT_PER_MM, h: area.height * PT_PER_MM };
    } else if (stationery === 'LABEL_4X4') {
      box = { x: 2 * PT_PER_MM, y: 2 * PT_PER_MM, w: pw - 4 * PT_PER_MM, h: ph - 4 * PT_PER_MM };
    }
    if (src) await placePage(out, page, src, i, box);
    else {
      const png = await out.embedPng(label);
      const scale = Math.min(box.w / png.width, box.h / png.height);
      page.drawImage(png, { x: box.x + (box.w - png.width * scale) / 2, y: box.y + (box.h - png.height * scale) / 2, width: png.width * scale, height: png.height * scale });
    }
  }
  return { pdf: await out.save(), pages: pageCount };
}

export interface PackingNoteInput {
  orderNumber: string;
  recipient: { name: string; company?: string | null; lines: string[] };
  sender: { name: string; lines: string[] };
  lines: { sku: string; name: string; quantity: number }[];
  courier?: string | null; method?: string | null; trackingNumber?: string | null;
  orderDate?: string;
  notes?: string | null;
}

async function barcodePng(text: string): Promise<Uint8Array> {
  const buf = await bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 10, includetext: false });
  return new Uint8Array(buf);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Packing note on the stationery's own page size (4x4 for thermal, A4 body for integrated sheets, 6x4 otherwise). */
export async function renderPackingNote(input: PackingNoteInput, stationery: Stationery, a4Area?: A4LabelArea): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE[stationery];
  const isA4 = stationery === 'A4_LEFT' || stationery === 'A4_RIGHT';
  const margin = isA4 ? 12 * PT_PER_MM : 4 * PT_PER_MM;
  const small = isA4 ? 9 : 7;
  const body = isA4 ? 10 : 8;
  const head = isA4 ? 16 : 11;
  let page = doc.addPage([pw, ph]);
  // On integrated sheets the label occupies the top area; start the note below it.
  const area = isA4 ? (a4Area ?? DEFAULT_A4_AREA[stationery as 'A4_LEFT']) : null;
  let y = ph - margin - (area ? (area.y + area.height + 6) * PT_PER_MM - margin : 0);
  const x = margin;
  const width = pw - 2 * margin;
  const text = (t: string, size = body, f: PDFFont = font, at = x) => { page.drawText(t, { x: at, y, size, font: f, color: rgb(0, 0, 0) }); };
  const down = (n: number) => { y -= n; };

  if (isA4 && area) {
    // Sender and recipient beside the label area on the free side of the sheet.
    const sideX = stationery === 'A4_LEFT' ? (area.x + area.width + 6) * PT_PER_MM : margin;
    let sy = ph - (area.y + 4) * PT_PER_MM;
    page.drawText('Deliver to', { x: sideX, y: sy, size: small, font: bold }); sy -= small + 2;
    for (const l of [input.recipient.name, input.recipient.company ?? '', ...input.recipient.lines].filter(Boolean)) { page.drawText(l, { x: sideX, y: sy, size: body, font }); sy -= body + 2; }
    sy -= 6;
    page.drawText('From', { x: sideX, y: sy, size: small, font: bold }); sy -= small + 2;
    for (const l of [input.sender.name, ...input.sender.lines].filter(Boolean)) { page.drawText(l, { x: sideX, y: sy, size: small, font }); sy -= small + 2; }
  }

  text(`Order ${input.orderNumber}`, head, bold); down(head + 4);
  const bc = await doc.embedPng(await barcodePng(input.orderNumber));
  const bcW = Math.min(width, isA4 ? 70 * PT_PER_MM : width);
  const bcH = bcW * (bc.height / bc.width);
  page.drawImage(bc, { x, y: y - bcH, width: bcW, height: bcH }); down(bcH + 6);
  if (!isA4) {
    text(`To: ${input.recipient.name}`, small, bold); down(small + 2);
    const addr = [input.recipient.company ?? '', ...input.recipient.lines].filter(Boolean).join(', ');
    for (const l of wrap(addr, font, small, width)) { text(l, small); down(small + 2); }
  }
  if (input.courier || input.method) { text(`${input.courier ?? ''} ${input.method ?? ''}`.trim(), small); down(small + 2); }
  if (input.trackingNumber) { text(`Tracking ${input.trackingNumber}`, small); down(small + 4); }
  down(4);
  // Lines
  const qtyX = x + width - 30;
  const boxX = x;
  const skuX = x + 14;
  text('Qty', small, bold, qtyX); text('Item', small, bold, skuX); down(small + 4);
  page.drawLine({ start: { x, y: y + 2 }, end: { x: x + width, y: y + 2 }, thickness: 0.5 });
  down(4);
  for (const line of input.lines) {
    if (y < margin + 30) { page = doc.addPage([pw, ph]); y = ph - margin; text(`Order ${input.orderNumber} (continued)`, body, bold); down(body + 6); }
    page.drawRectangle({ x: boxX, y: y - 1, width: 9, height: 9, borderWidth: 0.7, borderColor: rgb(0, 0, 0) });
    text(String(line.quantity), body + 1, bold, qtyX);
    const nameLines = wrap(`${line.sku}  ${line.name}`, font, body, qtyX - skuX - 6);
    for (const nl of nameLines) { text(nl, body, font, skuX); down(body + 2); }
    down(3);
  }
  if (input.notes) { down(6); for (const l of wrap(input.notes, font, small, width)) { text(l, small); down(small + 2); } }
  const pages = doc.getPageCount();
  if (pages > 1) doc.getPages().forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages}`, { x: pw - margin - 40, y: margin / 2, size: 6, font }));
  return doc.save();
}

export interface CustomsInvoiceInput {
  orderNumber: string;
  date: string;
  incoterm: string;
  currency: string;
  sender: { name: string; lines: string[]; eori?: string | null; vat?: string | null; ioss?: string | null };
  recipient: { name: string; lines: string[]; phone?: string | null; email?: string | null };
  lines: { description: string; hsCode?: string | null; origin?: string | null; quantity: number; unitValue: number; weightKg: number }[];
  parcels: number;
  totalWeightKg: number;
  reasonForExport?: string;
}

export async function renderCustomsInvoice(input: CustomsInvoiceInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE.A4_LEFT;
  const page = doc.addPage([pw, ph]);
  const m = 15 * PT_PER_MM;
  let y = ph - m;
  const t = (s: string, x: number, size = 9, f: PDFFont = font) => page.drawText(s, { x, y, size, font: f });
  t('COMMERCIAL INVOICE', m, 16, bold); y -= 22;
  t(`Invoice / order ${input.orderNumber}   Date ${input.date}   Incoterm ${input.incoterm}   Currency ${input.currency}   Parcels ${input.parcels}   Gross weight ${input.totalWeightKg.toFixed(2)} kg`, m, 9); y -= 18;
  const col2 = pw / 2;
  const startY = y;
  t('Sender / exporter', m, 9, bold); y -= 12;
  for (const l of [input.sender.name, ...input.sender.lines].filter(Boolean)) { t(l, m); y -= 11; }
  if (input.sender.eori) { t(`EORI ${input.sender.eori}`, m); y -= 11; }
  if (input.sender.vat) { t(`VAT ${input.sender.vat}`, m); y -= 11; }
  if (input.sender.ioss) { t(`IOSS ${input.sender.ioss}`, m); y -= 11; }
  const leftEnd = y;
  y = startY;
  t('Consignee / importer', col2, 9, bold); y -= 12;
  for (const l of [input.recipient.name, ...input.recipient.lines].filter(Boolean)) { t(l, col2); y -= 11; }
  if (input.recipient.phone) { t(`Tel ${input.recipient.phone}`, col2); y -= 11; }
  if (input.recipient.email) { t(input.recipient.email, col2); y -= 11; }
  y = Math.min(leftEnd, y) - 16;
  const cols = { desc: m, hs: m + 230, origin: m + 290, qty: m + 330, unit: m + 370, total: m + 430, weight: m + 490 };
  t('Description of goods', cols.desc, 8, bold); t('HS code', cols.hs, 8, bold); t('Origin', cols.origin, 8, bold); t('Qty', cols.qty, 8, bold); t('Unit value', cols.unit, 8, bold); t('Total', cols.total, 8, bold); t('Weight kg', cols.weight, 8, bold);
  y -= 4; page.drawLine({ start: { x: m, y }, end: { x: pw - m, y }, thickness: 0.5 }); y -= 12;
  let total = 0;
  for (const l of input.lines) {
    const lineTotal = l.quantity * l.unitValue; total += lineTotal;
    const descLines = wrap(l.description, font, 8, 220);
    t(descLines[0] ?? '', cols.desc, 8); t(l.hsCode ?? '', cols.hs, 8); t(l.origin ?? '', cols.origin, 8); t(String(l.quantity), cols.qty, 8);
    t(l.unitValue.toFixed(2), cols.unit, 8); t(lineTotal.toFixed(2), cols.total, 8); t(l.weightKg.toFixed(3), cols.weight, 8);
    y -= 11;
    for (const extra of descLines.slice(1)) { t(extra, cols.desc, 8); y -= 11; }
  }
  y -= 4; page.drawLine({ start: { x: m, y }, end: { x: pw - m, y }, thickness: 0.5 }); y -= 14;
  t(`Total value ${input.currency} ${total.toFixed(2)}`, cols.total - 60, 10, bold); y -= 20;
  t(`Reason for export: ${input.reasonForExport ?? 'Sale of goods'}`, m, 9); y -= 30;
  t('I declare that the information above is true and correct.', m, 9); y -= 24;
  t('Signature: ______________________________    Name: ______________________________    Date: ____________', m, 9);
  return doc.save();
}

/** Merge PDFs keeping each page's own size. */
export async function combinePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return out.save();
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
