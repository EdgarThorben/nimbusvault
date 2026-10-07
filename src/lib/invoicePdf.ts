import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { business, VAT_RATE } from "../config";
import { invoiceLabel, TIMEZONE } from "./jobs";
import { formatEur, lineNetCents, totals, vatPercentLabel, type PricedLine } from "./money";

export interface InvoiceInput {
  invoiceNumber: number;
  invoicedAt: Date;
  title: string;
  plate: string;
  makeModel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lines: (PricedLine & { description: string })[];
}

const INK = rgb(0.11, 0.12, 0.13);
const MUTED = rgb(0.36, 0.37, 0.39);
const ACCENT = rgb(0.76, 0.25, 0.05);

/** Standard PDF fonts only cover WinAnsi; swap anything else so a stray emoji can't break the invoice. */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

export async function renderInvoicePdf(inv: InvoiceInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${invoiceLabel(inv.invoiceNumber)}`);
  pdf.setAuthor(business.name);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]); // A4
  const left = 56;
  const right = 595.28 - 56;
  let y = 841.89 - 64;

  const text = (s: string, x: number, yy: number, opts: { size?: number; font?: PDFFont; color?: typeof INK } = {}) => {
    const font = opts.font ?? regular;
    page.drawText(safe(font, s), { x, y: yy, size: opts.size ?? 10, font, color: opts.color ?? INK });
  };
  const textRight = (s: string, xRight: number, yy: number, opts: { size?: number; font?: PDFFont } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const clean = safe(font, s);
    page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y: yy, size, font, color: INK });
  };

  // Header
  text(business.name, left, y, { size: 22, font: bold, color: ACCENT });
  const contact = [...business.address, business.phone, business.email];
  contact.forEach((l, i) => textRight(l, right, y + 6 - i * 13, { size: 9 }));
  y -= 90;

  // Customer + invoice meta
  text("Bill to", left, y, { size: 9, color: MUTED });
  text(inv.customerName, left, y - 15, { size: 11, font: bold });
  [inv.customerPhone, inv.customerEmail].filter(Boolean).forEach((l, i) => text(l, left, y - 30 - i * 13));

  const date = inv.invoicedAt.toLocaleDateString("en-GB", { timeZone: TIMEZONE });
  const meta: [string, string][] = [
    ["Invoice no.", invoiceLabel(inv.invoiceNumber)],
    ["Date", date],
    ["Vehicle", [inv.plate, inv.makeModel].filter(Boolean).join(" · ")],
  ];
  meta.forEach(([k, v], i) => {
    text(k, 330, y - i * 15, { size: 9, color: MUTED });
    text(v, 400, y - i * 15, { size: 10 });
  });
  y -= 80;

  text("Invoice", left, y, { size: 18, font: bold });
  text(inv.title, left, y - 18, { size: 10, color: MUTED });
  y -= 44;

  // Table
  const cols = { qty: 360, unit: 450, amount: right };
  const header = () => {
    text("Description", left, y, { size: 9, font: bold });
    textRight("Qty", cols.qty, y, { size: 9, font: bold });
    textRight("Unit (net)", cols.unit, y, { size: 9, font: bold });
    textRight("Amount (net)", cols.amount, y, { size: 9, font: bold });
    page.drawLine({ start: { x: left, y: y - 6 }, end: { x: right, y: y - 6 }, thickness: 0.8, color: INK });
    y -= 22;
  };
  header();

  for (const line of inv.lines) {
    if (y < 140) {
      page = pdf.addPage([595.28, 841.89]);
      y = 841.89 - 64;
      header();
    }
    const desc = line.kind === "labour" ? `${line.description} (labour, h)` : line.description;
    text(desc.length > 60 ? `${desc.slice(0, 59)}…` : desc, left, y);
    textRight(String(line.qty), cols.qty, y);
    textRight(formatEur(line.unitPriceCents), cols.unit, y);
    textRight(formatEur(lineNetCents(line)), cols.amount, y);
    y -= 18;
  }

  const t = totals(inv.lines);
  page.drawLine({ start: { x: 330, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.5, color: MUTED });
  y -= 10;
  const sum: [string, number, boolean][] = [
    ["Net", t.net, false],
    [`VAT ${vatPercentLabel}`, t.vat, false],
    ["Total", t.gross, true],
  ];
  for (const [label, cents, strong] of sum) {
    text(label, 330, y, { size: strong ? 12 : 10, font: strong ? bold : regular });
    textRight(formatEur(cents), right, y, { size: strong ? 12 : 10, font: strong ? bold : regular });
    y -= strong ? 22 : 16;
  }

  // Footer
  const fy = 72;
  page.drawLine({ start: { x: left, y: fy + 30 }, end: { x: right, y: fy + 30 }, thickness: 0.5, color: MUTED });
  text(`Please pay within ${business.paymentTermsDays} days, quoting ${invoiceLabel(inv.invoiceNumber)}.`, left, fy + 14, { size: 9 });
  text(`${business.bank.name} · IBAN ${business.bank.iban} · BIC ${business.bank.bic}`, left, fy, { size: 9, color: MUTED });
  text(`VAT ID ${business.vatId} · VAT rate ${Math.round(VAT_RATE * 100)}%`, left, fy - 13, { size: 9, color: MUTED });

  return pdf.save();
}
