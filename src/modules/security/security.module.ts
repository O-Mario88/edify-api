import { Module } from '@nestjs/common';
import { SecurityHealthService } from './security.service';
import { SecurityController } from './security.controller';

@Module({
  controllers: [SecurityController],
  providers: [SecurityHealthService],
})
export class SecurityModule {}
