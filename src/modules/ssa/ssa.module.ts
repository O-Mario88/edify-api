import { Module } from '@nestjs/common';
import { SsaService } from './ssa.service';
import { SsaController } from './ssa.controller';

@Module({
  controllers: [SsaController],
  providers: [SsaService],
  exports: [SsaService],
})
export class SsaModule {}
