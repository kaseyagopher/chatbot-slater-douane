import dotenv from 'dotenv';
import knexLib from 'knex';
import config from '../knexfile.js';

// Charger .env
dotenv.config();

async function run() {
  const knex = knexLib(config);
  try {
    console.log('Début des migrations...');
    const result = await knex.migrate.latest();
    console.log('Migrations terminées :', result);
    await knex.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Erreur lors des migrations:', err);
    try { await knex.destroy(); } catch (e) {}
    process.exit(1);
  }
}

run();
