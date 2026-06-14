"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const audit_hash_1 = require("../src/common/audit/audit-hash");
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        const rows = await prisma.auditLog.findMany({
            orderBy: { seq: 'asc' },
            select: {
                seq: true, action: true, subjectKind: true, subjectId: true, actorId: true,
                actorRole: true, success: true, reason: true, ipAddress: true, userAgent: true,
                correlationId: true, payload: true, prevHash: true, hash: true,
            },
        });
        let prev = '';
        let checked = 0;
        for (const r of rows) {
            if (r.hash === null) {
                prev = '';
                continue;
            }
            if ((r.prevHash ?? '') !== prev) {
                console.error(`CHAIN BROKEN at seq=${r.seq} (prevHash mismatch). ${checked} rows verified.`);
                process.exit(1);
            }
            const expected = (0, audit_hash_1.chainHash)(prev, (0, audit_hash_1.canonicalAudit)({ ...r, payload: r.payload ?? null }));
            if (expected !== r.hash) {
                console.error(`CHAIN BROKEN at seq=${r.seq} (hash mismatch — row was altered). ${checked} rows verified.`);
                process.exit(1);
            }
            prev = r.hash;
            checked += 1;
        }
        console.log(`Audit chain OK — ${checked} chained rows verified (of ${rows.length} total).`);
    }
    finally {
        await prisma.$disconnect();
    }
}
void main();
//# sourceMappingURL=audit-verify.js.map