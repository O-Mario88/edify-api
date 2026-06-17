/**
 * geo:subregions — seed the CONTROLLED sub-region mapping layer and link every
 * district to its sub-region, using the authoritative mapping supplied by the
 * product. Sub-regions are NOT in COD-AB, so this is an explicit controlled layer
 * (VERIFIED). Each district name is matched to the official COD-AB district via
 * the deterministic matcher; anything that does NOT match is reported and left
 * unlinked (REVIEW), never force-linked. Idempotent.
 *
 * Run: npm run geo:subregions
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeUgandaAdminName, matchAdminName, type GeoCandidate } from '../src/common/geography/normalize';

const prisma = new PrismaService();

// Authoritative product mapping: region → sub-region → district names.
const MAPPING: Record<string, Record<string, string[]>> = {
  Central: {
    'Kampala Capital City': ['Kampala Capital City'],
    Buganda: ['Buikwe', 'Bukomansimbi', 'Butambala', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu', 'Kassanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera', 'Luwero', 'Lwengo', 'Lyantonde', 'Masaka', 'Masaka City', 'Mityana', 'Mpigi', 'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai', 'Ssembabule', 'Wakiso'],
  },
  Eastern: {
    Busoga: ['Bugiri', 'Bugweri', 'Buyende', 'Iganga', 'Jinja', 'Jinja City', 'Kaliro', 'Kamuli', 'Luuka', 'Mayuge', 'Namayingo', 'Namutumba'],
    Bukedi: ['Budaka', 'Busia', 'Butaleja', 'Butebo', 'Kibuku', 'Pallisa', 'Tororo'],
    Bugisu: ['Bududa', 'Bulambuli', 'Manafwa', 'Mbale', 'Mbale City', 'Namisindwa', 'Sironko'],
    Sebei: ['Bukwo', 'Kapchorwa', 'Kween'],
    Teso: ['Amuria', 'Bukedea', 'Kaberamaido', 'Kalaki', 'Kapelebyong', 'Katakwi', 'Kumi', 'Ngora', 'Serere', 'Soroti', 'Soroti City'],
  },
  Northern: {
    Acholi: ['Agago', 'Amuru', 'Gulu', 'Gulu City', 'Kitgum', 'Lamwo', 'Nwoya', 'Omoro', 'Pader'],
    Lango: ['Alebtong', 'Amolatar', 'Apac', 'Dokolo', 'Kole', 'Kwania', 'Lira', 'Lira City', 'Otuke', 'Oyam'],
    Karamoja: ['Abim', 'Amudat', 'Kaabong', 'Karenga', 'Kotido', 'Moroto', 'Nabilatuk', 'Nakapiripirit', 'Napak'],
    'West Nile': ['Arua', 'Arua City', 'Koboko', 'Madi-Okollo', 'Maracha', 'Nebbi', 'Pakwach', 'Terego', 'Yumbe', 'Zombo'],
    Madi: ['Adjumani', 'Moyo', 'Obongi'],
  },
  Western: {
    Bunyoro: ['Buliisa', 'Hoima', 'Hoima City', 'Kagadi', 'Kakumiro', 'Kibaale', 'Kikuube', 'Kiryandongo', 'Masindi'],
    Tooro: ['Bunyangabu', 'Fort Portal City', 'Kabarole', 'Kamwenge', 'Kitagwenda', 'Kyegegwa', 'Kyenjojo'],
    Rwenzori: ['Bundibugyo', 'Kasese', 'Ntoroko'],
    Ankole: ['Buhweju', 'Bushenyi', 'Ibanda', 'Isingiro', 'Kazo', 'Kiruhura', 'Mbarara', 'Mbarara City', 'Mitooma', 'Ntungamo', 'Rubirizi', 'Rwampara', 'Sheema'],
    Kigezi: ['Kabale', 'Kanungu', 'Kisoro', 'Rubanda', 'Rukiga', 'Rukungiri'],
  },
};

async function main() {
  const regions = await prisma.region.findMany({ select: { id: true, name: true } });
  const regionByName = new Map(regions.map((r) => [r.name, r.id]));
  const allDistricts = await prisma.district.findMany({ select: { id: true, name: true } });
  const districtCands: GeoCandidate[] = allDistricts.map((d) => ({ id: d.id, name: d.name, normalizedName: normalizeUgandaAdminName(d.name) }));

  let linked = 0;
  const unmatched: string[] = [];

  for (const [regionName, subs] of Object.entries(MAPPING)) {
    const regionId = regionByName.get(regionName);
    if (!regionId) { console.warn(`region ${regionName} not found`); continue; }
    for (const [subName, districts] of Object.entries(subs)) {
      const sub = await prisma.subRegion.upsert({
        where: { name: subName },
        update: { confidence: 'VERIFIED', regionId, verifiedBy: 'geo:subregions', verifiedAt: new Date() },
        create: { name: subName, normalizedName: normalizeUgandaAdminName(subName), regionId, source: 'CONTROLLED', confidence: 'VERIFIED', verifiedBy: 'geo:subregions', verifiedAt: new Date(), notes: 'Authoritative product sub-region mapping.' },
      });
      for (const dName of districts) {
        // COD-AB (2020) folds the newer City units into their parent district, so
        // "Gulu City" / "Kampala Capital City" resolve to the COD-AB "Gulu" /
        // "Kampala" district. Strip a trailing "(capital) city" for matching only;
        // the original name is kept for the unmatched report.
        const matchName = dName.replace(/\s+(capital\s+)?city$/i, '');
        const m = matchAdminName(matchName, districtCands);
        if (m.matchedId && (m.status === 'EXACT' || m.status === 'ALIAS' || m.status === 'FUZZY_HIGH')) {
          await prisma.district.update({ where: { id: m.matchedId }, data: { subRegionId: sub.id } });
          linked++;
        } else {
          unmatched.push(`${subName} / ${dName} (${m.status}${m.matchedName ? ' ~ ' + m.matchedName : ''})`);
        }
      }
    }
  }

  const subRegionCount = await prisma.subRegion.count();
  const districtsLinked = await prisma.district.count({ where: { subRegionId: { not: null } } });
  console.log(`Sub-regions: ${subRegionCount} seeded (VERIFIED).`);
  console.log(`Districts linked: ${districtsLinked}/${allDistricts.length} (this run linked ${linked}).`);
  if (unmatched.length) {
    console.log(`\nUNMATCHED (${unmatched.length}) — left unlinked for review, NOT force-linked:`);
    unmatched.forEach((u) => console.log('  - ' + u));
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
