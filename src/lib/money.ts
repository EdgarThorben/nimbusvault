import { VAT_RATE } from "../config";
import type { LineItemKind } from "../db/schema";

export interface PricedLine {
  kind: LineItemKind;
  qty: number;
  unitPriceCents: number;
}

export function lineNetCents(line: PricedLine): number {
  return Math.round(line.qty * line.unitPriceCents);
}

export function totals(lines: PricedLine[]) {
  let partsNet = 0;
  let labourNet = 0;
  let labourHours = 0;
  for (const l of lines) {
    if (l.kind === "labour") {
      labourNet += lineNetCents(l);
      labourHours += l.qty;
    } else {
      partsNet += lineNetCents(l);
    }
  }
  const net = partsNet + labourNet;
  const vat = Math.round(net * VAT_RATE);
  return { partsNet, labourNet, labourHours, net, vat, gross: net + vat };
}

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export function formatEur(cents: number): string {
  return eur.format(cents / 100);
}

/** "12,50" / "12.50" / "12" → 1250. Returns null for anything that isn't a price. */
export function parsePriceToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function parseQty(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export const vatPercentLabel = `${Math.round(VAT_RATE * 1000) / 10}%`;
