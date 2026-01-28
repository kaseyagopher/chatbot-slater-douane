export async function up(knex) {
  await knex.schema.createTable("messages", (table) => {
    table.increments("id").primary();
    table.char("session_id", 36).nullable();
    table
      .enum("role", ["user", "assistant", "technician"])
      .notNullable()
      .defaultTo("user");
    table.char("agent_id", 36).nullable();
    table.text("content").nullable();
    table.json("metadata").nullable();
    table
      .dateTime("created_at")
      .defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("messages");
}
