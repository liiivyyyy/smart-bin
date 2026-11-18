import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "yolo",
  password: process.env.DB_PASSWORD || "yolo",
  database: process.env.DB_NAME || "yolo",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  charset: "utf8mb4",
  dateStrings: false,
});

const CREATE_USERS = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  hash_contrasena VARCHAR(255) NOT NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const CREATE_MODELS = `
CREATE TABLE IF NOT EXISTS modelos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  num_clases INT NOT NULL,
  clases JSON NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 0,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_modelos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const CREATE_PREDICTIONS = `
CREATE TABLE IF NOT EXISTS predicciones (
  id CHAR(32) PRIMARY KEY,
  usuario_id INT NOT NULL,
  url_imagen VARCHAR(255) NOT NULL,
  ancho INT NOT NULL,
  alto INT NOT NULL,
  cantidad INT NOT NULL,
  conf_minima DOUBLE NOT NULL,
  modelo_id INT NULL,
  nombre_modelo VARCHAR(50) NULL,
  detecciones JSON NOT NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_predicciones_usuario_fecha (usuario_id, fecha_creacion),
  INDEX idx_predicciones_modelo (modelo_id),
  CONSTRAINT fk_predicciones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_predicciones_modelo FOREIGN KEY (modelo_id)
    REFERENCES modelos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que MariaDB esté lista y crea las tablas si no existen. */
export async function initDb(retries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const conn = await pool.getConnection();
      try {
        await conn.query(CREATE_USERS);
        await conn.query(CREATE_MODELS);
        await conn.query(CREATE_PREDICTIONS);
      } finally {
        conn.release();
      }
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(delayMs);
    }
  }
}

/** MariaDB devuelve las columnas JSON como texto; normaliza a objeto. */
export function parseJson(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
