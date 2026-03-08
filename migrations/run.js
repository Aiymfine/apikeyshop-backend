require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigrations() {
  const sqlFile = path.join(__dirname, '001_init.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Migrations ran successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();
