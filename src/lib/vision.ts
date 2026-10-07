import Anthropic from "@anthropic-ai/sdk";

// Haiku reads photos and dictation and proposes form values. Advisory only: everything lands
// in editable fields for Leo to check, and any failure just returns nothing.
const MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
let warned = false;
function getClient(): Anthropic | null {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!warned) console.warn("[vision] ANTHROPIC_API_KEY is not set; AI suggestions are off.");
    warned = true;
    return null;
  }
  client ??= new Anthropic({ apiKey });
  return client;
}

export const aiEnabled = () => getClient() !== null;

export interface ImageInput {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

// Models sometimes answer "unknown" or "<UNKNOWN>" instead of leaving a field empty.
const PLACEHOLDER = /^[<\[(]?\s*(unknown|unbekannt|n\/?a|none|not visible|not readable|-+)\s*[>\])]?$/i;
const str = (v: unknown, max = 300) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return PLACEHOLDER.test(s) ? "" : s;
};
/** "m - kx 4711" → "M-KX 4711" (German style: hyphen after the district, one space before the digits). */
const plate = (v: unknown) =>
  str(v, 20).toUpperCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, 999) : 0);

async function callTool(
  system: string,
  tool: Anthropic.Tool,
  images: ImageInput[],
  text: string,
): Promise<Record<string, unknown> | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType, data: img.data.toString("base64") },
            })),
            { type: "text" as const, text },
          ],
        },
      ],
    });
    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return (block?.input as Record<string, unknown>) ?? null;
  } catch (err) {
    console.error("[vision] Haiku call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface CheckInSuggestion {
  plate: string;
  makeModel: string;
  title: string;
  customerName: string;
  phone: string;
  email: string;
  notes: string;
}

const EMPTY_CHECKIN: CheckInSuggestion = {
  plate: "", makeModel: "", title: "", customerName: "", phone: "", email: "", notes: "",
};

/** Reads plate and car from photos, and job/customer details from Leo's dictation. */
export async function suggestCheckIn(images: ImageInput[], transcript: string): Promise<CheckInSuggestion> {
  const input = await callTool(
    "You help a car mechanic check in a car. Extract only what is clearly visible in the photos or said in " +
      "the dictation. Leave a field empty rather than guess. Copy number plates exactly as printed, in capitals, " +
      "keeping the hyphen and spaces (German style 'B-AB 1234'). The dictation may be German or English; " +
      "write the task title as a short English phrase like 'Front brakes' and keep names and numbers as said.",
    {
      name: "fill_check_in",
      description: "Fill the check-in form.",
      input_schema: {
        type: "object",
        properties: {
          plate: { type: "string", description: "Number plate, empty if not readable" },
          makeModel: { type: "string", description: "Make and model, e.g. 'VW Golf VII'" },
          title: { type: "string", description: "What needs doing, 2-5 words" },
          customerName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          notes: { type: "string", description: "Other useful details from the dictation (symptoms, damage)" },
        },
        required: ["plate", "makeModel", "title", "customerName", "phone", "email", "notes"],
      },
    },
    images,
    transcript ? `Dictation:\n${transcript}` : "No dictation. Use the photos only.",
  );
  if (!input) return EMPTY_CHECKIN;
  return {
    plate: plate(input.plate),
    makeModel: str(input.makeModel, 60),
    title: str(input.title, 80),
    customerName: str(input.customerName, 80),
    phone: str(input.phone, 30),
    email: str(input.email, 120),
    notes: str(input.notes, 1000),
  };
}

export interface JobSuggestion {
  findings: string;
  lines: { description: string; kind: "part" | "labour"; qty: number }[];
}

/** Drafts findings and estimate lines (no prices) from the job's photos and notes. */
export async function suggestFromPhotos(
  images: ImageInput[],
  context: { title: string; makeModel: string; findings: string },
): Promise<JobSuggestion> {
  const input = await callTool(
    "You assist a car mechanic. From the photos and notes, describe what is visibly wrong and propose repair " +
      "lines. Be concrete and conservative: only list what the evidence supports. Never give prices. " +
      "Labour is one line with estimated hours as qty. Write in plain English a customer understands.",
    {
      name: "draft_estimate",
      description: "Draft findings and estimate lines.",
      input_schema: {
        type: "object",
        properties: {
          findings: { type: "string", description: "1-3 sentences for the customer" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                kind: { type: "string", enum: ["part", "labour"] },
                qty: { type: "number" },
              },
              required: ["description", "kind", "qty"],
            },
          },
        },
        required: ["findings", "lines"],
      },
    },
    images,
    `Job: ${context.title}\nCar: ${context.makeModel || "unknown"}\nMechanic's notes so far: ${context.findings || "(none)"}`,
  );
  if (!input) return { findings: "", lines: [] };
  const lines = Array.isArray(input.lines) ? input.lines.slice(0, 10) : [];
  return {
    findings: str(input.findings, 1000),
    lines: lines
      .map((l: Record<string, unknown>) => ({
        description: str(l?.description, 120),
        kind: l?.kind === "labour" ? ("labour" as const) : ("part" as const),
        qty: Math.round((num(l?.qty) || 1) * 100) / 100,
      }))
      .filter((l) => l.description),
  };
}
