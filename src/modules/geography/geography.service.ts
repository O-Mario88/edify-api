import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GeographyService {
  constructor(private readonly prisma: PrismaService) {}

  listRegions() {
    return this.prisma.region.findMany({ orderBy: { name: 'asc' } });
  }

  listDistricts(regionId?: string) {
    return this.prisma.district.findMany({
      where: regionId ? { regionId } : undefined,
      orderBy: { name: 'asc' },
      include: { region: { select: { name: true } } },
    });
  }

  listSubCounties(districtId: string) {
    return this.prisma.subCounty.findMany({ where: { districtId }, orderBy: { name: 'asc' } });
  }

  // Parish layer (admin4) — from UG-AU-DS-2022. Empty for sub-counties the
  // dataset didn't cover.
  listParishes(subCountyId: string) {
    return this.prisma.parish.findMany({
      where: { subCountyId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, source: true },
    });
  }

  // Village layer (admin5) — the leaf, from UG-AU-DS-2022.
  listVillages(parishId: string) {
    return this.prisma.village.findMany({
      where: { parishId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }
}
