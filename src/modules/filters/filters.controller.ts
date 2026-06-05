import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FiltersService } from './filters.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

type FilterQ = { fy?: string; regionId?: string; districtId?: string; subCountyId?: string; clusterId?: string; schoolType?: string };

@ApiTags('filters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('filters')
export class FiltersController {
  constructor(private readonly filters: FiltersService) {}

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.filters.options(user);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query() q: FilterQ) {
    return this.filters.counts(user, q);
  }

  @Get('core-header-summary')
  coreHeader(@CurrentUser() user: AuthUser, @Query() q: FilterQ) {
    return this.filters.coreHeaderSummary(user, q);
  }
}
