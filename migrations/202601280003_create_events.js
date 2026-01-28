export async function up(knex) {
  await knex.schema.createTable("events", (table) => {
    table.increments("id").primary();
    table.char("session_id", 36).notNullable();
    table.string("event_type", 64).notNullable();
    table.text("payload", "longtext").nullable();
    table
      .dateTime("created_at")
      .defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("events");
}
