import type { PageDetail } from "../db/schema";

export const CATEGORY_ORDER = ["Compute", "Storage & Backup", "Pricing", "Operations"];

export function groupDetailsByCategory(details: PageDetail[]) {
  const groups = new Map<string, PageDetail[]>();
  for (const d of details) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category)!.push(d);
  }
  const knownFirst = CATEGORY_ORDER.filter((c) => groups.has(c));
  const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
  return [...knownFirst, ...rest].map((cat) => ({ category: cat, items: groups.get(cat)! }));
}
