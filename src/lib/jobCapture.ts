import Anthropic from "@anthropic-ai/sdk";
import type { PageDetail } from "../db/schema";

export interface JobExtraction {
  plate: string;
  make: string;
  model: string;
  mileage: number;
  findings: string[];
  parts: { name: string; quantity: number; unitPrice: number }[];
  labourHours: number;
  estimateTotal: number;
}

export const EMPTY_JOB: JobExtraction = {
  plate: "",
  make: "",
  model: "",
  mileage: 0,
  findings: [],
  parts: [],
  labourHours: 0,
  estimateTotal: 0,
};

export const JOB_LABELS = {
  plate: "Kennzeichen",
  total: "Gesamtbetrag (geschätzt)",
} as const;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = import.meta.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client ??= new Anthropic({ apiKey });
  return client;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** One Haiku call with a forced tool call. Degrades to an empty extraction on any failure. */
export async function extractJob(
  notes: string,
  images: { data: string }[],
): Promise<JobExtraction> {
  const anthropic = getClient();
  if (!anthropic) return EMPTY_JOB;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system:
        "Du erfasst Werkstattaufträge aus einem Diktat und Fotos. Verwende nur, was im Text oder auf den Fotos belegt ist. " +
        "Unbekannte Werte: leerer String bzw. 0. Erfinde keine Preise. Kennzeichen in Großbuchstaben. Beträge in Euro brutto.",
      tools: [
        {
          name: "record_job",
          description: "Speichert den erfassten Werkstattauftrag.",
          input_schema: {
            type: "object",
            properties: {
              plate: { type: "string" },
              make: { type: "string" },
              model: { type: "string" },
              mileage: { type: "integer", description: "Kilometerstand in km" },
              findings: { type: "array", items: { type: "string" } },
              parts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "integer" },
                    unitPrice: { type: "number" },
                  },
                  required: ["name", "quantity", "unitPrice"],
                },
              },
              labourHours: { type: "number" },
              estimateTotal: { type: "number" },
            },
            required: [
              "plate",
              "make",
              "model",
              "mileage",
              "findings",
              "parts",
              "labourHours",
              "estimateTotal",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_job" },
      messages: [
        {
          role: "user",
          content: [
            ...images.map(
              (img) =>
                ({
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data: img.data },
                }) as const,
            ),
            { type: "text", text: `Diktat / Notizen:\n${notes || "(keine)"}` },
          ],
        },
      ],
    });

    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = (block?.input ?? {}) as Record<string, unknown>;
    return {
      plate: str(input.plate).toUpperCase(),
      make: str(input.make),
      model: str(input.model),
      mileage: Math.round(num(input.mileage)),
      findings: Array.isArray(input.findings) ? input.findings.map(str).filter(Boolean) : [],
      parts: Array.isArray(input.parts)
        ? input.parts
            .map((p: Record<string, unknown>) => ({
              name: str(p?.name),
              quantity: Math.max(1, Math.round(num(p?.quantity)) || 1),
              unitPrice: num(p?.unitPrice),
            }))
            .filter((p) => p.name)
        : [],
      labourHours: num(input.labourHours),
      estimateTotal: num(input.estimateTotal),
    };
  } catch {
    return EMPTY_JOB;
  }
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function buildJobFields(job: JobExtraction, notes: string): PageDetail[] {
  const fields: PageDetail[] = [
    { category: "Fahrzeug", label: JOB_LABELS.plate, value: job.plate },
    { category: "Fahrzeug", label: "Marke", value: job.make },
    { category: "Fahrzeug", label: "Modell", value: job.model },
    { category: "Fahrzeug", label: "Kilometerstand", value: job.mileage ? `${job.mileage} km` : "" },
  ];
  job.findings.forEach((f, i) => fields.push({ category: "Befund", label: `Befund ${i + 1}`, value: f }));
  for (const p of job.parts) {
    fields.push({
      category: "Teile",
      label: p.name,
      value: p.unitPrice ? `${p.quantity} × ${eur(p.unitPrice)}` : `${p.quantity} ×`,
    });
  }
  fields.push(
    { category: "Kosten", label: "Arbeitsstunden", value: job.labourHours ? String(job.labourHours) : "" },
    { category: "Kosten", label: JOB_LABELS.total, value: job.estimateTotal ? eur(job.estimateTotal) : "" },
  );
  if (notes) fields.push({ category: "Notiz", label: "Diktat", value: notes });
  return fields.filter((f) => f.value);
}
