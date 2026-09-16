import Anthropic from "@anthropic-ai/sdk";
import type { ItemType, PageDetail } from "../db/schema";
import { CATEGORY_ORDER } from "./details";
import { requiredFieldLabelsByItemType } from "./itemCompleteness";

// --- AI-assisted normalization ---
//
// getMissingRequiredFields() matches labels by exact (normalized) string, so
// an item carrying "Memory" instead of "RAM" reads as incomplete even though
// the data is there. Rather than maintaining a hand-written synonym table
// that never keeps up with how people actually type, we ask Claude to map
// free-text labels onto the canonical set for the item's type.
//
// Everything here is advisory: suggestions are surfaced to the author, who
// applies or ignores them. Nothing is rewritten automatically, and a failed
// or unconfigured API call degrades to "no suggestions" rather than blocking
// a save.

const MODEL = "claude-opus-5";

export interface LabelSuggestion {
  /** Index into the `fields` array the suggestion applies to. */
  index: number;
  /** Which part of the row to change. */
  target: "label" | "category";
  from: string;
  to: string;
  reason: string;
}

export interface DuplicateSuggestion {
  slug: string;
  name: string;
  reason: string;
}

export interface NormalizationResult {
  /** False when no API key is configured — the UI hides the panel entirely. */
  available: boolean;
  suggestions: LabelSuggestion[];
  duplicates: DuplicateSuggestion[];
}

const EMPTY: NormalizationResult = { available: false, suggestions: [], duplicates: [] };

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = import.meta.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client ??= new Anthropic({ apiKey });
  return client;
}

export function isNormalizationAvailable(): boolean {
  return getClient() !== null;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          target: { type: "string", enum: ["label", "category"] },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["index", "target", "to", "reason"],
        additionalProperties: false,
      },
    },
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string" },
          reason: { type: "string" },
        },
        required: ["slug", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions", "duplicates"],
  additionalProperties: false,
};

interface RawResponse {
  suggestions: { index: number; target: "label" | "category"; to: string; reason: string }[];
  duplicates: { slug: string; reason: string }[];
}

/**
 * Cheap local pre-filter for the duplicate check. Sending the whole item table
 * to the model on every save would be wasteful — a shared significant word is
 * a low bar that still cuts the candidate set to something worth asking about.
 */
export function shortlistDuplicateCandidates<T extends { slug: string; name: string; type: string }>(
  name: string,
  type: ItemType,
  all: T[],
  limit = 8,
): T[] {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 2));
  const target = tokens(name);
  if (target.size === 0) return [];

  return all
    .map((candidate) => {
      const shared = [...tokens(candidate.name)].filter((w) => target.has(w)).length;
      // Same-type items are likelier duplicates than a doc that happens to
      // share a word with a server, so nudge them up rather than filtering
      // the other types out entirely.
      return { candidate, score: shared + (candidate.type === type ? 0.5 : 0) };
    })
    .filter((r) => r.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.candidate);
}

const SYSTEM_PROMPT = `You normalize records in an IT asset database (a CMDB).

You are given a draft record and the canonical vocabulary its fields should use. Return two things:

1. suggestions — field rows whose label or category should be renamed to a canonical term that means the same thing. Only suggest a rename when the existing text is a synonym, abbreviation, translation, or casing/spacing variant of a canonical term. Do not suggest a rename when the row genuinely describes something outside the canonical list, and never suggest changing a field's value.
2. duplicates — items from the candidate list that appear to document the same real-world thing as the draft, not merely a similar or related one. Two servers in a cluster with sequential names are NOT duplicates. A candidate is a duplicate only if the names look like two spellings of one machine, service, or document.

Be conservative. Returning empty arrays is the correct answer for a clean record. Write each reason as one short sentence.`;

/**
 * Asks Claude to map a draft item's field labels onto the canonical vocabulary
 * and to flag likely duplicate items. Returns `available: false` when no API
 * key is set, and empty arrays (never throws) on any API failure — a flaky or
 * rate-limited API must not stop someone documenting a server.
 */
export async function suggestNormalizations(input: {
  type: ItemType;
  name: string;
  fields: PageDetail[];
  duplicateCandidates: { slug: string; name: string; type: string }[];
}): Promise<NormalizationResult> {
  const anthropic = getClient();
  if (!anthropic) return EMPTY;
  if (input.fields.length === 0 && input.duplicateCandidates.length === 0) {
    return { available: true, suggestions: [], duplicates: [] };
  }

  const payload = {
    draft: {
      type: input.type,
      name: input.name,
      // The index is what the client applies a suggestion against, so it has
      // to travel with the row rather than being implied by array position.
      fields: input.fields.map((f, index) => ({ index, category: f.category, label: f.label })),
    },
    canonical_labels_for_this_type: requiredFieldLabelsByItemType[input.type] ?? [],
    canonical_categories: CATEGORY_ORDER,
    duplicate_candidates: input.duplicateCandidates.map((c) => ({
      slug: c.slug,
      name: c.name,
      type: c.type,
    })),
  };

  let raw: RawResponse;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Low effort: this is a short, well-specified mapping task, and it sits
      // in the path of a form submission where latency is visible.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    });

    if (response.stop_reason === "refusal") {
      return { available: true, suggestions: [], duplicates: [] };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    raw = JSON.parse(text) as RawResponse;
  } catch (error) {
    console.error("[fieldNormalizer] suggestion request failed", error);
    return { available: true, suggestions: [], duplicates: [] };
  }

  // The model sees indices and slugs, not our objects — re-resolve everything
  // against the real input so a hallucinated index or slug can't reach the UI.
  const suggestions: LabelSuggestion[] = (raw.suggestions ?? []).flatMap((s) => {
    const field = input.fields[s.index];
    if (!field) return [];
    const from = s.target === "label" ? field.label : field.category;
    if (!s.to || s.to === from) return [];
    return [{ index: s.index, target: s.target, from, to: s.to, reason: s.reason }];
  });

  const bySlug = new Map(input.duplicateCandidates.map((c) => [c.slug, c]));
  const duplicates: DuplicateSuggestion[] = (raw.duplicates ?? []).flatMap((d) => {
    const candidate = bySlug.get(d.slug);
    if (!candidate) return [];
    return [{ slug: candidate.slug, name: candidate.name, reason: d.reason }];
  });

  return { available: true, suggestions, duplicates };
}
