// Uganda administrative-name normalization — the single function every geography
// match goes through, so free-text school uploads resolve to official COD-AB
// records deterministically (never silent fuzzy guessing). The ORIGINAL text is
// always preserved by the caller; this only produces a comparison key.

const DIACRITICS = /[̀-ͯ]/g;

// Tokens that are administrative *suffixes*, not part of the place identity, and
// are commonly present/absent across sources ("Lira District" == "Lira"). We
// strip them so "Lira District" and "LIRA" both normalize to "lira". We do NOT
// strip "Town Council"/"Division"/"Municipality" — those distinguish distinct
// units (e.g. "Lira" district vs "Lira City" — keep them separate).
const SUFFIXES = [
  "district",
  "sub county",
  "subcounty",
  "sub-county",
  "county",
  "parish",
  "region",
];

/**
 * Normalize a Ugandan admin name to a stable comparison key.
 * - trims, collapses whitespace, lowercases
 * - strips diacritics and apostrophes/punctuation
 * - normalizes "sub-county" / "sub county" / "subcounty" spacing
 * - removes a trailing admin-level suffix word ("district", "county", …)
 * The caller keeps the raw text; this is only for matching.
 */
export function normalizeUgandaAdminName(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.normalize("NFKD").replace(DIACRITICS, "");
  s = s.toLowerCase().trim();
  // unify apostrophes/punctuation → space; keep alphanumerics + spaces
  s = s.replace(/['’`.,]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\bsub\s*county\b/g, "subcounty"); // unify sub-county spellings
  s = s.replace(/\s+/g, " ").trim();
  // strip a trailing admin suffix word (only at the end, only once)
  for (const suf of SUFFIXES) {
    const re = new RegExp(`\\s${suf.replace(/[-\s]/g, "\\s*")}$`);
    if (re.test(s)) {
      s = s.replace(re, "").trim();
      break;
    }
  }
  return s;
}

/** Levenshtein distance (small strings) — for strict, bounded fuzzy matching. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Similarity ratio in [0,1] from normalized Levenshtein. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export type GeoMatchStatus =
  | "EXACT"
  | "ALIAS"
  | "FUZZY_HIGH"
  | "FUZZY_LOW_REVIEW_REQUIRED"
  | "UNMATCHED";

export type GeoCandidate = { id: string; name: string; normalizedName: string };

export type GeoMatch = {
  status: GeoMatchStatus;
  confidence: number; // 0..1
  matchedId: string | null;
  matchedName: string | null;
  warnings: string[];
};

// Strict thresholds — a high bar before we auto-accept a fuzzy match; anything
// below goes to the review queue rather than being silently accepted.
export const FUZZY_HIGH_THRESHOLD = 0.9;
export const FUZZY_REVIEW_FLOOR = 0.75;

/**
 * Resolve a free-text admin name against a candidate set (already scoped to the
 * correct parent — e.g. only sub-counties within the matched district).
 * `aliases` maps a normalizedAlias → candidate id (from GeographyAlias).
 */
export function matchAdminName(
  raw: string | null | undefined,
  candidates: GeoCandidate[],
  aliases?: Map<string, string>,
): GeoMatch {
  const norm = normalizeUgandaAdminName(raw);
  if (!norm) return { status: "UNMATCHED", confidence: 0, matchedId: null, matchedName: null, warnings: ["empty input"] };

  // 1) exact normalized match
  const exact = candidates.find((c) => c.normalizedName === norm);
  if (exact) return { status: "EXACT", confidence: 1, matchedId: exact.id, matchedName: exact.name, warnings: [] };

  // 2) alias match
  if (aliases?.has(norm)) {
    const id = aliases.get(norm)!;
    const c = candidates.find((x) => x.id === id);
    if (c) return { status: "ALIAS", confidence: 0.97, matchedId: c.id, matchedName: c.name, warnings: [] };
  }

  // 3) strict fuzzy
  let best: GeoCandidate | null = null;
  let bestSim = 0;
  for (const c of candidates) {
    const sim = similarity(norm, c.normalizedName);
    if (sim > bestSim) { bestSim = sim; best = c; }
  }
  if (best && bestSim >= FUZZY_HIGH_THRESHOLD) {
    return { status: "FUZZY_HIGH", confidence: bestSim, matchedId: best.id, matchedName: best.name, warnings: [`fuzzy match "${raw}" → "${best.name}" (${bestSim.toFixed(2)})`] };
  }
  if (best && bestSim >= FUZZY_REVIEW_FLOOR) {
    return { status: "FUZZY_LOW_REVIEW_REQUIRED", confidence: bestSim, matchedId: best.id, matchedName: best.name, warnings: [`low-confidence match "${raw}" → "${best.name}" (${bestSim.toFixed(2)}) — review required`] };
  }
  return { status: "UNMATCHED", confidence: bestSim, matchedId: null, matchedName: null, warnings: [`no confident match for "${raw}"`] };
}
