import bcrypt from "bcryptjs";

import { pool } from "./db.js";

const RONDAS_BCRYPT = Number(process.env.BCRYPT_ROUNDS || 10);

export function hashContrasena(contrasena) {
  return bcrypt.hash(contrasena, RONDAS_BCRYPT);
}

export function verificarContrasena(contrasena, hash) {
  return bcrypt.compare(contrasena, hash);
}

/**
 * preHandler de Fastify: valida el JWT y adjunta el usuario de la BD a
 * request.usuarioBd. Responde 401 con { detalle } si el token no es válido.
 */
export async function autenticar(request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ detalle: "Credenciales no válidas" });
  }

  const usuario = request.user?.sub;
  if (!usuario) {
    return reply.code(401).send({ detalle: "Credenciales no válidas" });
  }

  const [rows] = await pool.execute(
    "SELECT id, usuario FROM usuarios WHERE usuario = ? LIMIT 1",
    [usuario],
  );

  if (rows.length === 0) {
    return reply.code(401).send({ detalle: "Credenciales no válidas" });
  }

  request.usuarioBd = rows[0];
}
