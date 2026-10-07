import type { ItemType, PageDetail } from "../db/schema";

// Per-type "control system" for CI data: labels an item of this type is
// expected to have filled in before it's considered complete. Modeled on the
// client's ELSTER reference — it won't let a submission through until every
// expected field has arrived, so we surface the same gap as a warning here
// instead of blocking the save.
export const requiredFieldLabelsByItemType: Record<ItemType, string[]> = {
  document: [],
  // Modeled on a real client VPS quote (Hetzner CAX11-style: CPU/RAM/storage/
  // traffic/OS/backup as the baseline spec sheet) — confirmed 2026-07-14.
  server: ["CPU", "RAM", "Storage", "Traffic", "Operating System", "Backup"],
  "storage-disk": ["Capacity", "RAID Level"],
  database: ["Engine", "Version", "Owner"],
  application: ["Owner", "Version"],
  workstation: ["Assigned User", "Location"],
  "network-device": ["IP Address", "Location"],
  "software-license": ["Seats", "Renewal Date"],
  service: ["Owner", "SLA"],
  vehicle: [],
  job: [],
  other: [],
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function getMissingRequiredFields(type: ItemType, fields: PageDetail[]): string[] {
  const required = requiredFieldLabelsByItemType[type] ?? [];
  if (required.length === 0) return [];

  const present = new Set(
    fields.filter((f) => f.value.trim().length > 0).map((f) => normalize(f.label)),
  );

  return required.filter((label) => !present.has(normalize(label)));
}
