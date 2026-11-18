import { pool } from "./db.js";

/** Normaliza una fila de `modelos` al formato que usa la API. */
function toModel(row) {
  return row ? { id: row.id, nombre: row.nombre } : null;
}

/**
 * Devuelve el modelo registrado para la metadata que reporta el worker.
 * El nombre llega como `trainN_ULTIMOS4HASH` (p. ej. 56_0FA0); si no existe,
 * se registra automáticamente.
 */
export async function ensureModel(meta) {
  if (!meta) {
    const [rows] = await pool.execute(
      "SELECT id, nombre FROM modelos WHERE activo = 1 ORDER BY id LIMIT 1",
    );
    return toModel(rows[0]);
  }

  const hashCorto = String(meta.sha256 || "0000").slice(-4).toUpperCase();
  const nombrePorDefecto = `0_${hashCorto}`;
  const nombreCrudo =
    typeof meta.name === "string" && meta.name.trim()
      ? meta.name.trim()
      : nombrePorDefecto;
  const nombre =
    nombreCrudo.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50) ||
    nombrePorDefecto;

  const [found] = await pool.execute(
    "SELECT id, nombre FROM modelos WHERE nombre = ? LIMIT 1",
    [nombre],
  );
  if (found.length > 0) return toModel(found[0]);

  const clases =
    meta.classes && typeof meta.classes === "object" ? meta.classes : {};
  const numClases = Number(
    meta.num_classes || Object.keys(clases).length || 0,
  );

  try {
    const [result] = await pool.execute(
      "INSERT INTO modelos (nombre, num_clases, clases, activo) VALUES (?, ?, ?, 1)",
      [nombre, numClases, JSON.stringify(clases)],
    );

    // Solo un modelo queda como activo: el último que se usó.
    await pool.execute("UPDATE modelos SET activo = 0 WHERE id <> ?", [
      result.insertId,
    ]);

    return { id: result.insertId, nombre };
  } catch (err) {
    // Otra petición pudo registrarlo en paralelo.
    if (err.code === "ER_DUP_ENTRY") {
      const [rows] = await pool.execute(
        "SELECT id, nombre FROM modelos WHERE nombre = ? LIMIT 1",
        [nombre],
      );
      if (rows.length > 0) return toModel(rows[0]);
    }
    throw err;
  }
}
