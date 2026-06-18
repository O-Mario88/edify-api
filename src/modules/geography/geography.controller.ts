import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GeographyService } from './geography.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';

@ApiTags('geography')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('geography')
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get('regions')
  regions() {
    return this.geography.listRegions();
  }

  @Get('districts')
  districts(@Query('regionId') regionId?: string) {
    return this.geography.listDistricts(regionId);
  }

  @Get('sub-counties')
  subCounties(@Query('districtId') districtId: string) {
    return this.geography.listSubCounties(districtId);
  }

  @Get('parishes')
  parishes(@Query('subCountyId') subCountyId: string) {
    return this.geography.listParishes(subCountyId);
  }

  @Get('villages')
  villages(@Query('parishId') parishId: string) {
    return this.geography.listVillages(parishId);
  }
}
