import { Module } from '@nestjs/common';
import { SpecialProjectsService } from './special-projects.service';
import { SpecialProjectsController } from './special-projects.controller';

@Module({
  controllers: [SpecialProjectsController],
  providers: [SpecialProjectsService],
})
export class SpecialProjectsModule {}
