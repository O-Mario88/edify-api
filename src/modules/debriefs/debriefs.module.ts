import { Module } from '@nestjs/common';
import { DebriefsService } from './debriefs.service';
import { DebriefsController } from './debriefs.controller';

@Module({
  controllers: [DebriefsController],
  providers: [DebriefsService],
})
export class DebriefsModule {}
