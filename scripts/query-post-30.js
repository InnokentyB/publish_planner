const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
    const res = await pool.query('SELECT * FROM posts WHERE id = 30');
    console.log(res.rows);
    await pool.end();
}
main().catch(console.error);
