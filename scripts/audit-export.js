"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
async function main() {
    const day = process.argv[2];
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        console.error('Usage: audit:export -- <YYYY-MM-DD>');
        process.exit(2);
    }
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(`${day}T23:59:59.999Z`);
    const dir = (0, node_path_1.resolve)(process.env.AUDIT_EXPORT_DIR ?? 'exports/audit');
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    const prisma = new client_1.PrismaClient();
    try {
        const rows = await prisma.auditLog.findMany({
            where: { createdAt: { gte: start, lte: end } },
            orderBy: { seq: 'asc' },
        });
        const out = (0, node_path_1.join)(dir, `audit-${day}.ndjson`);
        const body = rows.map((r) => JSON.stringify({ ...r, seq: r.seq.toString() })).join('\n');
        (0, node_fs_1.writeFileSync)(out, body, { mode: 0o600 });
        console.log(`Exported ${rows.length} audit rows for ${day} -> ${out}`);
    }
    finally {
        await prisma.$disconnect();
    }
}
void main();
//# sourceMappingURL=audit-export.js.map