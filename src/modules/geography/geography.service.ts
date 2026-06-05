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
}
