// Realistic Uganda geography for the final-demo seed.
//
// Region → District → Sub-county → Parish, using real Ugandan place names so
// the demo's geography filtering, cluster creation, and sub-county cluster
// eligibility all read as authentic. This REPLACES the old fabricated
// "<District> North/South" test fixtures.
//
// Scale is tuned for a convincing-but-navigable demo (4 regions, 16 districts,
// ~80 sub-counties, ~230 parishes) rather than exhaustively reproducing all
// ~1,300 national sub-counties.

export type SubCountySeed = { name: string; parishes: string[] };
export type DistrictSeed = { name: string; subCounties: SubCountySeed[] };
export type RegionSeed = { name: string; districts: DistrictSeed[] };

export const UGANDA_GEOGRAPHY: RegionSeed[] = [
  {
    name: 'Northern',
    districts: [
      {
        name: 'Lira',
        subCounties: [
          { name: 'Adekokwok', parishes: ['Anai', 'Barapwo', 'Ayago'] },
          { name: 'Agali', parishes: ['Agali', 'Adyel', 'Acanpii'] },
          { name: 'Barr', parishes: ['Apala', 'Aleltong', 'Ogwette'] },
          { name: 'Ogur', parishes: ['Ogur', 'Anyomorem', 'Acungkena'] },
          { name: 'Amach', parishes: ['Amach', 'Abako', 'Anyangapuc'] },
        ],
      },
      {
        name: 'Gulu',
        subCounties: [
          { name: 'Bardege', parishes: ['Bardege', 'Kasubi', 'Kanyagoga'] },
          { name: 'Layibi', parishes: ['Layibi Central', 'Agwee', 'Pawel'] },
          { name: 'Pece', parishes: ['Pece', 'Vanguard', 'Cubu'] },
          { name: 'Bungatira', parishes: ['Bungatira', 'Coope', 'Punena'] },
          { name: 'Paicho', parishes: ['Paicho', 'Pageya', 'Lapeta'] },
        ],
      },
      {
        name: 'Kitgum',
        subCounties: [
          { name: 'Kitgum Town', parishes: ['Pajimo', 'Pandwong', 'Bardwong'] },
          { name: 'Mucwini', parishes: ['Mucwini', 'Lukung', 'Loyo-Ajonga'] },
          { name: 'Namokora', parishes: ['Namokora', 'Lokwor', 'Pajong'] },
          { name: 'Akwang', parishes: ['Akwang', 'Lagoro', 'Kitgum Matidi'] },
        ],
      },
      {
        name: 'Apac',
        subCounties: [
          { name: 'Apac', parishes: ['Akere', 'Atik', 'Cu-cu'] },
          { name: 'Aduku', parishes: ['Aduku', 'Inomo', 'Alenga'] },
          { name: 'Ibuje', parishes: ['Ibuje', 'Acii', 'Teboke'] },
          { name: 'Chegere', parishes: ['Chegere', 'Akokoro', 'Apoi'] },
        ],
      },
    ],
  },
  {
    name: 'Eastern',
    districts: [
      {
        name: 'Mbale',
        subCounties: [
          { name: 'Industrial Division', parishes: ['Namatala', 'Doko', 'Mooni'] },
          { name: 'Wanale Division', parishes: ['Bungokho', 'Busamaga', 'Nabuyonga'] },
          { name: 'Northern Division', parishes: ['Nkoma', 'Namakwekwe', 'Malukhu'] },
          { name: 'Bungokho', parishes: ['Bumasikye', 'Bukasakya', 'Lwasso'] },
          { name: 'Nakaloke', parishes: ['Nakaloke', 'Namabasa', 'Lwangoli'] },
        ],
      },
      {
        name: 'Soroti',
        subCounties: [
          { name: 'Soroti', parishes: ['Aloet', 'Opiyai', 'Dakabela'] },
          { name: 'Gweri', parishes: ['Gweri', 'Agirigiroi', 'Tubur'] },
          { name: 'Asuret', parishes: ['Asuret', 'Morukakise', 'Awaliwal'] },
          { name: 'Arapai', parishes: ['Arapai', 'Acetgwen', 'Aukot'] },
        ],
      },
      {
        name: 'Tororo',
        subCounties: [
          { name: 'Tororo', parishes: ['Rock', 'Bison', 'Aleensi'] },
          { name: 'Malaba', parishes: ['Malaba', 'Apokor', 'Pajwenda'] },
          { name: 'Rubongi', parishes: ['Rubongi', 'Pajwenda', 'Kayoro'] },
          { name: 'Mukuju', parishes: ['Mukuju', 'Pawanga', 'Petta'] },
        ],
      },
      {
        name: 'Jinja',
        subCounties: [
          { name: 'Jinja Central', parishes: ['Mpumudde', 'Walukuba', 'Masese'] },
          { name: 'Budondo', parishes: ['Budondo', 'Buwenge', 'Namizi'] },
          { name: 'Buwenge', parishes: ['Buwenge', 'Kakira', 'Magamaga'] },
          { name: 'Mafubira', parishes: ['Mafubira', 'Wairaka', 'Buwekula'] },
        ],
      },
    ],
  },
  {
    name: 'Central',
    districts: [
      {
        name: 'Kampala',
        subCounties: [
          { name: 'Central Division', parishes: ['Nakasero', 'Old Kampala', 'Kamwokya'] },
          { name: 'Kawempe Division', parishes: ['Kawempe', 'Kazo', 'Bwaise'] },
          { name: 'Makindye Division', parishes: ['Makindye', 'Katwe', 'Nsambya'] },
          { name: 'Nakawa Division', parishes: ['Nakawa', 'Bugolobi', 'Ntinda'] },
          { name: 'Rubaga Division', parishes: ['Rubaga', 'Mengo', 'Najjanankumbi'] },
        ],
      },
      {
        name: 'Wakiso',
        subCounties: [
          { name: 'Nansana', parishes: ['Nansana', 'Gombe', 'Wamala'] },
          { name: 'Kira', parishes: ['Kira', 'Bweyogerere', 'Kireka'] },
          { name: 'Makindye-Ssabagabo', parishes: ['Ndejje', 'Bunamwaya', 'Lubowa'] },
          { name: 'Kasangati', parishes: ['Kasangati', 'Gayaza', 'Masooli'] },
          { name: 'Wakiso', parishes: ['Wakiso', 'Kabumbi', 'Nakawuka'] },
        ],
      },
      {
        name: 'Mukono',
        subCounties: [
          { name: 'Mukono Division', parishes: ['Mukono', 'Ggulu', 'Namumira'] },
          { name: 'Goma', parishes: ['Goma', 'Seeta', 'Namataba'] },
          { name: 'Nakisunga', parishes: ['Nakisunga', 'Kasenge', 'Ntunda'] },
          { name: 'Ntenjeru', parishes: ['Ntenjeru', 'Nakifuma', 'Kalagi'] },
        ],
      },
      {
        name: 'Masaka',
        subCounties: [
          { name: 'Katwe-Butego', parishes: ['Katwe', 'Butego', 'Kimaanya'] },
          { name: 'Nyendo-Mukungwe', parishes: ['Nyendo', 'Mukungwe', 'Bukakata'] },
          { name: 'Kabonera', parishes: ['Kabonera', 'Kyanamukaaka', 'Buwunga'] },
          { name: 'Mukungwe', parishes: ['Mukungwe', 'Kkingo', 'Kyesiiga'] },
        ],
      },
    ],
  },
  {
    name: 'Western',
    districts: [
      {
        name: 'Mbarara',
        subCounties: [
          { name: 'Kakoba', parishes: ['Kakoba', 'Katete', 'Ruti'] },
          { name: 'Nyamitanga', parishes: ['Nyamitanga', 'Kamukuzi', 'Rwemigina'] },
          { name: 'Biharwe', parishes: ['Biharwe', 'Rubaya', 'Nyakayojo'] },
          { name: 'Rwanyamahembe', parishes: ['Rwanyamahembe', 'Rubindi', 'Bwizibwera'] },
          { name: 'Kagongi', parishes: ['Kagongi', 'Kashare', 'Rugando'] },
        ],
      },
      {
        name: 'Kabale',
        subCounties: [
          { name: 'Central Division', parishes: ['Kirigime', 'Makanga', 'Kamukira'] },
          { name: 'Northern Division', parishes: ['Bugongi', 'Rushaki', 'Kitumba'] },
          { name: 'Bubaare', parishes: ['Bubaare', 'Karujanga', 'Kitanga'] },
          { name: 'Kaharo', parishes: ['Kaharo', 'Buhara', 'Rwamucucu'] },
        ],
      },
      {
        name: 'Kabarole',
        subCounties: [
          { name: 'Fort Portal Central', parishes: ['Kabundaire', 'Mpanga', 'Kitumba'] },
          { name: 'East Division', parishes: ['Karambi', 'Busoro', 'Kiko'] },
          { name: 'West Division', parishes: ['Kasusu', 'Njara', 'Kateebwa'] },
          { name: 'Karambi', parishes: ['Karambi', 'Rwimi', 'Harugongo'] },
        ],
      },
      {
        name: 'Bushenyi',
        subCounties: [
          { name: 'Bushenyi-Ishaka', parishes: ['Bushenyi', 'Ishaka', 'Nyakabirizi'] },
          { name: 'Kyamuhunga', parishes: ['Kyamuhunga', 'Bitooma', 'Kakanju'] },
          { name: 'Ruhumuro', parishes: ['Ruhumuro', 'Kyabugimbi', 'Bumbaire'] },
          { name: 'Kakanju', parishes: ['Kakanju', 'Nyabubare', 'Kyeizooba'] },
        ],
      },
    ],
  },
];

// A few parish names above intentionally use only ASCII; normalize any stray
// non-ASCII so the seed never produces odd characters in the directory.
function asciiClean(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function geographyRows(): {
  region: string;
  district: string;
  subCounty: string;
  parish: string;
}[] {
  const rows: { region: string; district: string; subCounty: string; parish: string }[] = [];
  for (const r of UGANDA_GEOGRAPHY) {
    for (const d of r.districts) {
      for (const sc of d.subCounties) {
        for (const p of sc.parishes) {
          rows.push({
            region: r.name,
            district: d.name,
            subCounty: asciiClean(sc.name),
            parish: asciiClean(p) || asciiClean(sc.name),
          });
        }
      }
    }
  }
  return rows;
}
