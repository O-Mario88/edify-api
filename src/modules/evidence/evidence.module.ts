import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { EVIDENCE_SCANNER, NoopEvidenceScanner } from './evidence-scanner';

@Module({
  controllers: [EvidenceController],
  providers: [
    EvidenceService,
    // Swap NoopEvidenceScanner for a ClamAV-backed scanner in production.
    { provide: EVIDENCE_SCANNER, useClass: NoopEvidenceScanner },
  ],
})
export class EvidenceModule {}
