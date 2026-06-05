import { Module } from '@nestjs/common';
import { ClustersService } from './clusters.service';
import { ClustersController } from './clusters.controller';

@Module({
  controllers: [ClustersController],
  providers: [ClustersService],
  exports: [ClustersService],
})
export class ClustersModule {}
