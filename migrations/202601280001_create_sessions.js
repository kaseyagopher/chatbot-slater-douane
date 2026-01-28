export async function up(knex) {
  await knex.schema.createTable("sessions", (table) => {
    table.char("id", 36).primary();
    table.dateTime("created_at").notNullable();
    table.dateTime("last_activity").notNullable();
    table.boolean("technician_connected").notNullable().defaultTo(false);
    table.char("technician_id", 36).nullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("sessions");
}
