import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import formbody from "@fastify/formbody";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";

import { initDb, pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import predictRoutes from "./routes/predict.js";
import resultRoutes from "./routes/results.js";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const SECRET_KEY = process.env.SECRET_KEY || "cambia-esta-clave-en-produccion";
const TOKEN_MINUTES = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 1440);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const fastify = Fastify({
  logger: true,
  bodyLimit: MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024,
});

await fastify.register(jwt, {
  secret: SECRET_KEY,
  sign: { expiresIn: `${TOKEN_MINUTES}m` },
});

await fastify.register(formbody);

await fastify.register(multipart, {
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
    fields: 10,
  },
});

// Toda respuesta de error usa { detalle }.
fastify.setErrorHandler((error, request, reply) => {
  if (error.code === "FST_REQ_FILE_TOO_LARGE") {
    return reply
      .code(413)
      .send({ detalle: `La imagen supera ${MAX_UPLOAD_MB} MB` });
  }

  let statusCode = error.statusCode;
  if (!statusCode || statusCode < 400) statusCode = 500;

  if (statusCode >= 500) {
    request.log.error({ err: error }, "error no controlado");
  }

  return reply.code(statusCode).send({
    detalle: statusCode >= 500 ? "Error interno del servidor" : error.message,
  });
});

fastify.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ detalle: "No encontrado" });
});

await initDb();

fastify.get("/health", async (request, reply) => {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    request.log.error({ err }, "la base de datos no responde");
    return reply.code(503).send({ estado: "error", base_datos: "caida" });
  }
  return {
    estado: "ok",
    modelo: process.env.YOLO_MODEL || "best.pt",
    dispositivo: process.env.YOLO_DEVICE || "cpu",
  };
});

await fastify.register(authRoutes);
await fastify.register(predictRoutes);
await fastify.register(resultRoutes);

// Frontend estático (un único index.html con CSS/JS embebidos).
const indexHtml = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
const sendIndex = (request, reply) =>
  reply.type("text/html; charset=utf-8").send(indexHtml);

fastify.get("/", sendIndex);
fastify.get("/index.html", sendIndex);

const shutdown = async (signal) => {
  fastify.log.info(`recibido ${signal}, cerrando...`);
  try {
    await fastify.close();
    await pool.end();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await fastify.listen({ host: HOST, port: PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}