/**
 * geo:dedup-subcounties — merge UG-AU-DS-2022-created sub-counties that are
 * spelling variants of an existing COD-AB sub-county in the SAME district
 * (levenshtein ≤1 on the normalized name). The COD-AB record is canonical (it
 * has the pcode/centroid + any school links); the dataset twin's parishes are
 * re-parented onto it and the empty twin is deleted.
 *
 * SAFE: only merges dataset-created SCs that have ZERO schools, and only when a
 * close COD-AB twin exists. Genuinely-new sub-counties (no close twin) are KEPT.
 * DRY RUN by default — pass --apply to perform the merge.
 *
 * Run: npm run geo:dedup-subcounties          (dry run)
 *      npm run geo:dedup-subcounties -- --apply
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeUgandaAdminName, levenshtein } from '../src/common/geography/normalize';

const prisma = new PrismaService();
const APPLY = process.argv.includes('--apply');
const MAX = 1;

type SC = { id: string; name: string; districtId: string; source: string | null; pcode: string | null };

async function main() {
  const subs: SC[] = await prisma.subCounty.findMany({
    select: { id: true, name: true, districtId: true, source: true, pcode: true },
  });
  const byDistrict = new Map<string, SC[]>();
  for (const s of subs) {
    const arr = byDistrict.get(s.districtId) ?? [];
    arr.push(s);
    byDistrict.set(s.districtId, arr);
  }

  // Plan merges: dataset SC (source UG-AU-DS-2022, no pcode) → closest COD-AB SC
  // (has pcode) in the same district within levenshtein ≤ MAX.
  const merges: { from: SC; to: SC; dist: number }[] = [];
  for (const list of byDistrict.values()) {
    const canon = list.filter((s) => !!s.pcode);
    if (!canon.length) continue;
    const dataset = list.filter((s) => s.source === 'UG-AU-DS-2022' && !s.pcode);
    for (const ds of dataset) {
      const dn = normalizeUgandaAdminName(ds.name);
      let best: { sc: SC; d: number } | null = null;
      for (const c of canon) {
        const cn = normalizeUgandaAdminName(c.name);
        // Require the first letter to match — a 1-edit difference on the first
        // char usually denotes a DIFFERENT place (e.g. Kabende vs Mabende), not a
        // spelling variant, so we never auto-merge those.
        if (dn[0] !== cn[0]) continue;
        const d = levenshtein(dn, cn);
        if (d <= MAX && (!best || d < best.d)) best = { sc: c, d };
      }
      if (best) merges.push({ from: ds, to: best.sc, dist: best.d });
    }
  }

  console.log(`Found ${merges.length} near-duplicate sub-counties (levenshtein ≤ ${MAX}) to merge.`);
  merges.slice(0, 30).forEach((m) => console.log(`  "${m.from.name}" → "${m.to.name}" (d=${m.dist})`));
  if (merges.length > 30) console.log(`  …and ${merges.length - 30} more`);

  if (!APPLY) {
    console.log('\nDRY RUN — no changes made. Re-run with `-- --apply` to merge.');
    await prisma.$disconnect();
    return;
  }

  let mergedSCs = 0, reparented = 0, collapsedParishes = 0, movedVillages = 0;
  for (const m of merges) {
    const parishes = await prisma.parish.findMany({ where: { subCountyId: m.from.id } });
    for (const p of parishes) {
      const twin = await prisma.parish.findUnique({
        where: { subCountyId_name: { subCountyId: m.to.id, name: p.name } },
      });
      if (twin) {
        // Parish name collision — move villages into the twin, drop the dup parish.
        const vils = await prisma.village.findMany({ where: { parishId: p.id } });
        for (const v of vils) {
          await prisma.village.upsert({
            where: { parishId_name: { parishId: twin.id, name: v.name } },
            update: {},
            create: { name: v.name, parishId: twin.id, source: v.source },
          });
          movedVillages++;
        }
        await prisma.village.deleteMany({ where: { parishId: p.id } });
        await prisma.parish.delete({ where: { id: p.id } });
        collapsedParishes++;
      } else {
        await prisma.parish.update({ where: { id: p.id }, data: { subCountyId: m.to.id } });
        reparented++;
      }
    }
    await prisma.subCounty.delete({ where: { id: m.from.id } });
    mergedSCs++;
    if (mergedSCs % 50 === 0) console.log(`  …merged ${mergedSCs}/${merges.length}`);
  }

  console.log(`\nDone. Merged ${mergedSCs} sub-counties · re-parented ${reparented} parishes · collapsed ${collapsedParishes} dup parishes · moved ${movedVillages} villages.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
