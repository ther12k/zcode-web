// Literal, separator-aware directory containment for root-scoped queries.
//
// Deliberately NOT `directory LIKE ? || '/%'`: LIKE treats '_' and '%' as
// wildcards, so a configured root of /ws/project_a also matched
// /ws/projectXa/private, and LIKE is ASCII-case-insensitive while Linux
// filesystems are not. substr() gives exact, case-sensitive prefix matching
// with an explicit separator check — no escaping rules to get wrong.
export function directoryScope(column, roots) {
  if (!roots || !roots.length) return { sql: "0", params: [] };
  const clause =
    `(${column} = ?` +
    ` OR (length(${column}) > length(?)` +
    ` AND substr(${column}, 1, length(?)) = ?` +
    ` AND substr(${column}, length(?) + 1, 1) = '/'))`;
  return {
    sql: `(${roots.map(() => clause).join(" OR ")})`,
    params: roots.flatMap((r) => [r, r, r, r, r]),
  };
}
