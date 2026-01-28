export default {
  client: "mysql2",
  connection: {
    host: Number(process.env.DB_HOST|| 3306),
    user: process.env.DB_USER ,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl : false
  },
  migrations: {
    directory: "./migrations",
  },
};
