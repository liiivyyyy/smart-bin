import { parseJson, pool } from "../db.js";
import { autenticar } from "../auth.js";
import { httpError } from "../http-error.js";
import { ensureModel } from "../models.js";

const WORKER_URL = (process.env.WORKER_URL || "http://worker:9000").replace(/\/+$/, "");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);
const DEFAULT_CONF = Number(process.env.YOLO_CONF || 0.25);
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS || 120000);

export default async function predictRoutes(fastify) {
  fastify.post("/predict", { preHandler: autenticar }, async (request) => {
    let fileBuffer = null;
    let filename = "upload.jpg";
    let mimetype = "application/octet-stream";
    let confMinima = DEFAULT_CONF;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileBuffer) {
          // Consume y descarta archivos extra para no romper el stream.
          await part.toBuffer();
          continue;
        }
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === "conf_minima") {
        const parsed = Number.parseFloat(part.value);
        if (Number.isFinite(parsed)) confMinima = parsed;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw httpError(400, "Falta el archivo");
    }
    if (fileBuffer.length > MAX_UPLOAD_MB * 1024 * 1024) {
      throw httpError(413, `La imagen supera ${MAX_UPLOAD_MB} MB`);
    }
    if (!(confMinima > 0 && confMinima <= 1)) {
      throw httpError(400, "conf_minima debe estar entre 0 y 1");
    }

    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: mimetype }), filename);
    form.append("conf_minima", String(confMinima));

    let workerRes;
    try {
      workerRes = await fetch(`${WORKER_URL}/infer`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
      });
    } catch (err) {
      request.log.error({ err }, "no se pudo contactar al worker de inferencia");
      throw httpError(502, "El servicio de inferencia no está disponible");
    }

    if (!workerRes.ok) {
      let detail = "Error en el servicio de inferencia";
      try {
        const payload = await workerRes.json();
        if (payload?.detail) detail = payload.detail;
      } catch {
        // La respuesta del worker no era JSON.
      }
      const status =
        workerRes.status >= 400 && workerRes.status < 500 ? workerRes.status : 502;
      throw httpError(status, detail);
    }

    const result = await workerRes.json();

    // Trazabilidad: qué modelo/versión generó esta predicción.
    const model = await ensureModel(result.model);

    await pool.execute(
      "INSERT INTO predicciones " +
        "(id, usuario_id, url_imagen, ancho, alto, cantidad, conf_minima, modelo_id, nombre_modelo, detecciones) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        result.id,
        request.usuarioBd.id,
        result.image_url,
        result.width,
        result.height,
        result.count,
        confMinima,
        model?.id ?? null,
        model?.nombre ?? null,
        JSON.stringify(result.detections ?? []),
      ],
    );

    return {
      id: result.id,
      url_imagen: result.image_url,
      ancho: result.width,
      alto: result.height,
      cantidad: result.count,
      conf_minima: confMinima,
      modelo_id: model?.id ?? null,
      nombre_modelo: model?.nombre ?? null,
      detecciones: result.detections,
    };
  });

  fastify.get(
    "/predictions",
    { preHandler: autenticar },
    async (request) => {
      const [rows] = await pool.execute(
        "SELECT id, url_imagen, ancho, alto, cantidad, conf_minima, modelo_id, nombre_modelo, detecciones, fecha_creacion " +
          "FROM predicciones WHERE usuario_id = ? ORDER BY fecha_creacion DESC, id DESC LIMIT 100",
        [request.usuarioBd.id],
      );

      return rows.map((p) => ({
        id: p.id,
        url_imagen: p.url_imagen,
        ancho: p.ancho,
        alto: p.alto,
        cantidad: p.cantidad,
        conf_minima: p.conf_minima,
        modelo_id: p.modelo_id,
        nombre_modelo: p.nombre_modelo,
        detecciones: parseJson(p.detecciones),
        fecha_creacion:
          p.fecha_creacion instanceof Date
            ? p.fecha_creacion.toISOString()
            : p.fecha_creacion,
      }));
    },
  );
}