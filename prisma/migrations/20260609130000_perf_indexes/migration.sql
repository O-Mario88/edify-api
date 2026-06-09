-- Hot-path performance indexes (command-center / budget / accountant / scope)
CREATE INDEX "Activity_scheduledDate_idx" ON "Activity"("scheduledDate");
CREATE INDEX "Activity_assignedPartnerId_idx" ON "Activity"("assignedPartnerId");
CREATE INDEX "Activity_iaVerificationStatus_paymentStatus_idx" ON "Activity"("iaVerificationStatus", "paymentStatus");
CREATE INDEX "Activity_evidenceStatus_idx" ON "Activity"("evidenceStatus");
CREATE INDEX "StaffSupervisorAssignment_supervisorId_idx" ON "StaffSupervisorAssignment"("supervisorId");
CREATE INDEX "StaffGeographyAssignment_staffId_idx" ON "StaffGeographyAssignment"("staffId");
