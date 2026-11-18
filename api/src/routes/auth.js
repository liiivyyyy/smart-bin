import { pool } from "../db.js";
import {
  autenticar,
  hashContrasena,
  verificarContrasena,
} from "../auth.js";
import { httpError } from "../http-error.js";

export default async function authRoutes(fastify) {
  fastify.post("/auth/register", async (request) => {
    const body = request.body || {};
    const usuario =
      typeof body.usuario === "string" ? body.usuario.trim() : "";
    const contrasena =
      typeof body.contrasena === "string" ? body.contrasena : "";

    if (usuario.length < 3 || usuario.length > 50) {
      throw httpError(400, "El usuario debe tener entre 3 y 50 caracteres");
    }
    if (contrasena.length < 4) {
      throw httpError(400, "La contraseña debe tener al menos 4 caracteres");
    }

    const hash = await hashContrasena(contrasena);

    try {
      await pool.execute(
        "INSERT INTO usuarios (usuario, hash_contrasena) VALUES (?, ?)",
        [usuario, hash],
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        throw httpError(400, "El usuario ya existe");
      }
      throw err;
    }

    const token = fastify.jwt.sign({ sub: usuario });
    return {
      token_acceso: token,
      tipo_token: "bearer",
      usuario,
    };
  });

  fastify.post("/auth/login", async (request) => {
    const body = request.body || {};
    const usuario = typeof body.usuario === "string" ? body.usuario : "";
    const contrasena =
      typeof body.contrasena === "string" ? body.contrasena : "";

    const [rows] = await pool.execute(
      "SELECT id, usuario, hash_contrasena FROM usuarios WHERE usuario = ? LIMIT 1",
      [usuario],
    );

    if (rows.length === 0) {
      throw httpError(401, "Usuario o contraseña incorrectos");
    }

    const valida = await verificarContrasena(
      contrasena,
      rows[0].hash_contrasena,
    );
    if (!valida) {
      throw httpError(401, "Usuario o contraseña incorrectos");
    }

    const token = fastify.jwt.sign({ sub: rows[0].usuario });
    return {
      token_acceso: token,
      tipo_token: "bearer",
      usuario: rows[0].usuario,
    };
  });

  fastify.get(
    "/auth/me",
    { preHandler: autenticar },
    async (request) => ({
      usuario: request.usuarioBd.usuario,
      id: request.usuarioBd.id,
    }),
  );
}
