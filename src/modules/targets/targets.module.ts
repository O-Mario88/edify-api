import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';
import { AssignmentModule } from '../assignment/assignment.module';

@Module({
  imports: [AssignmentModule],
  controllers: [TargetsController],
  providers: [TargetsService],
})
export class TargetsModule {}
