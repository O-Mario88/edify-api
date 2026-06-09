import { Module } from '@nestjs/common';
import { CommandCenterService } from './command-center.service';
import { CommandCenterController } from './command-center.controller';

@Module({
  controllers: [CommandCenterController],
  providers: [CommandCenterService],
})
export class CommandCenterModule {}
