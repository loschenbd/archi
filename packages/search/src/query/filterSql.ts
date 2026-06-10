import type { SearchFilters } from "../types.js";

export type CandidateSql = {
  sql: string;
  params: unknown[];
};

/**
 * Build a SELECT that returns the candidate set of passage ids matching the
 * structured filters. Caller is expected to merge in archive/hidden defaults
 * from Settings before calling.
 */
export function buildCandidateSql(filters: SearchFilters): CandidateSql {
  const where: string[] = [];
  const params: unknown[] = [];

  const includeArchived = filters.isArchived === true;
  const includeHidden = filters.isHidden === true;
  if (!includeArchived) {
    where.push("p.is_archived = 0");
  }
  if (!includeHidden) {
    where.push("p.is_hidden = 0");
  }

  if (filters.creator !== undefined) {
    where.push("w.creator = ?");
    params.push(filters.creator);
  }
  if (filters.workType !== undefined) {
    where.push("w.work_type = ?");
    params.push(filters.workType);
  }
  if (filters.workIds !== undefined && filters.workIds.length > 0) {
    where.push(`p.work_id IN (${filters.workIds.map(() => "?").join(",")})`);
    params.push(...filters.workIds);
  }
  if (filters.isStarred === true) {
    where.push("p.is_starred = 1");
  }
  if (filters.markerColor !== undefined) {
    where.push("p.marker_color = ?");
    params.push(filters.markerColor);
  }
  if (filters.markedAfter !== undefined) {
    where.push("p.marked_at >= ?");
    params.push(filters.markedAfter);
  }
  if (filters.markedBefore !== undefined) {
    where.push("p.marked_at <= ?");
    params.push(filters.markedBefore);
  }
  if (filters.labels !== undefined && filters.labels.length > 0) {
    // passages.labels_json is a TEXT JSON array. Intersect via json_each.
    where.push(`EXISTS (
      SELECT 1 FROM json_each(p.labels_json)
      WHERE json_each.value IN (${filters.labels.map(() => "?").join(",")})
    )`);
    params.push(...filters.labels);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT p.id AS id
    FROM passages p
    JOIN works w ON p.work_id = w.id
    ${whereClause}
  `;
  return { sql, params };
}
