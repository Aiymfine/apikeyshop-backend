require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigrations() {
  try {
    const files = fs
      .readdirSync(__dirname)
      .filter((f) => /^\d+.*\.sql$/i.test(f))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const sqlFile = path.join(__dirname, file);
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await pool.query(sql);
      console.log(`✅ Applied migration: ${file}`);
    }

    console.log('✅ Migrations ran successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();
