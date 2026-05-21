"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
require("./bootstrap-env");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
exports.pool = new pg_1.Pool({
    connectionString,
    connectionTimeoutMillis: 5000
});
const adapter = new adapter_pg_1.PrismaPg(exports.pool);
const prisma = new client_1.PrismaClient({ adapter });
exports.default = prisma;
