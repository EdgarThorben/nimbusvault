import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { items, type ItemStatus, type ItemType, type RelationshipType } from "../db/schema";

/**
 * Returns true if adding the directed edge
 * `itemId --relationshipType--> relatedItemId` would create a cycle —
 * i.e. `relatedItemId` can already (directly or transitively) reach
 * `itemId` via existing item_relationships rows.
 *
 * This is app-level, not a DB constraint, because Postgres check
 * constraints can't express "no path back to the origin" across an
 * arbitrary number of hops. See CLAUDE.md's data-model rules.
 */
export async function wouldCreateCycle(itemId: string, relatedItemId: string): Promise<boolean> {
  if (itemId === relatedItemId) return true;

  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE reachable(id) AS (
      SELECT related_item_id AS id
      FROM item_relationships
      WHERE item_id = ${relatedItemId}
      UNION
      SELECT ir.related_item_id AS id
      FROM item_relationships ir
      JOIN reachable r ON ir.item_id = r.id
    )
    SELECT 1 AS id FROM reachable WHERE id = ${itemId} LIMIT 1
  `);

  return result.rows.length > 0;
}

// --- Impact analysis ---
// The "what breaks if this dies" query. An edge reads
// `itemId --relationshipType--> relatedItemId` (web-01 depends_on switch-1),
// so the blast radius of X is everything that can *reach* X by walking edges
// forward — i.e. walking edges backwards from X. The reverse walk gives what
// X itself needs to stay up.
//
// This is a recursive CTE rather than a separate graph database on purpose:
// the edge set here is small (hundreds of rows), and keeping it in Postgres
// means impact queries stay transactionally consistent with `items` and
// `credentials` instead of needing dual writes to a second datastore.

/** Hard stop on traversal depth — a runaway walk on a dense graph is a
 *  worse failure than an incomplete answer. */
export const MAX_IMPACT_DEPTH = 6;

export interface ImpactNode {
  id: string;
  slug: string;
  name: string;
  type: ItemType;
  status: ItemStatus;
  /** 1 = directly attached to the origin item, 2+ = reached through others. */
  depth: number;
  /** The relationship on the final hop into this node. */
  relationshipType: RelationshipType;
  /** Name of the node one hop closer to the origin, or null at depth 1. */
  via: string | null;
}

export interface ImpactGraph {
  /** Items that would be affected if the origin item failed. */
  dependents: ImpactNode[];
  /** Items the origin item itself relies on. */
  dependencies: ImpactNode[];
  /** True if the walk hit MAX_IMPACT_DEPTH and may be incomplete. */
  truncated: boolean;
}

interface ImpactRow extends Record<string, unknown> {
  id: string;
  depth: number;
  relationship_type: RelationshipType;
  parent_id: string | null;
}

/**
 * One direction of the walk. `direction` picks which column the recursion
 * follows: "upstream" collects sources pointing at the origin (blast radius),
 * "downstream" collects targets the origin points at (its dependencies).
 *
 * `NOT ... = ANY(path)` is what keeps a cyclic graph from looping forever.
 * wouldCreateCycle() blocks cycles at write time, but this query has to stay
 * safe against rows that predate it or were inserted out of band.
 */
async function walk(originId: string, direction: "upstream" | "downstream"): Promise<ImpactRow[]> {
  // The column we step *to*, and the column we match the current node against.
  const next = direction === "upstream" ? sql`ir.item_id` : sql`ir.related_item_id`;
  const from = direction === "upstream" ? sql`ir.related_item_id` : sql`ir.item_id`;

  const result = await db.execute<ImpactRow>(sql`
    WITH RECURSIVE walk(id, depth, path, relationship_type, parent_id) AS (
      SELECT
        ${next} AS id,
        1 AS depth,
        ARRAY[${originId}::uuid, ${next}] AS path,
        ir.relationship_type,
        NULL::uuid AS parent_id
      FROM item_relationships ir
      WHERE ${from} = ${originId}::uuid

      UNION ALL

      SELECT
        ${next} AS id,
        w.depth + 1,
        w.path || ${next},
        ir.relationship_type,
        w.id AS parent_id
      FROM item_relationships ir
      JOIN walk w ON ${from} = w.id
      WHERE w.depth < ${MAX_IMPACT_DEPTH}
        AND NOT ${next} = ANY(w.path)
    )
    -- A node reachable by several routes is listed once, at its shortest one.
    SELECT DISTINCT ON (id) id, depth, relationship_type, parent_id
    FROM walk
    ORDER BY id, depth ASC
  `);

  return result.rows;
}

/**
 * Resolves both directions of the impact graph for an item, hydrating each
 * reached node with the item record it refers to.
 */
export async function getImpactGraph(originId: string): Promise<ImpactGraph> {
  const [upstream, downstream] = await Promise.all([
    walk(originId, "upstream"),
    walk(originId, "downstream"),
  ]);

  const rows = [...upstream, ...downstream];
  if (rows.length === 0) {
    return { dependents: [], dependencies: [], truncated: false };
  }

  // One lookup covers both directions — reached nodes and the parents we
  // name in `via` are all in this same id set.
  const ids = [...new Set(rows.flatMap((r) => [r.id, r.parent_id].filter((v): v is string => !!v)))];
  const itemRows = await db
    .select({
      id: items.id,
      slug: items.slug,
      name: items.name,
      type: items.type,
      status: items.status,
    })
    .from(items)
    .where(inArray(items.id, ids));
  const byId = new Map(itemRows.map((i) => [i.id, i]));

  const hydrate = (list: ImpactRow[]): ImpactNode[] =>
    list
      .flatMap((row) => {
        const item = byId.get(row.id);
        if (!item) return [];
        return [{
          ...item,
          depth: row.depth,
          relationshipType: row.relationship_type,
          via: row.parent_id ? byId.get(row.parent_id)?.name ?? null : null,
        }];
      })
      // Closest blast radius first; alphabetical within a ring so the list is
      // stable between renders.
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  return {
    dependents: hydrate(upstream),
    dependencies: hydrate(downstream),
    truncated: rows.some((r) => r.depth >= MAX_IMPACT_DEPTH),
  };
}
