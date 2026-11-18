import { readFile } from "node:fs/promises";
import path from "node:path";

import { httpError } from "../http-error.js";

const RESULTS_DIR = process.env.RESULTS_DIR || "/data/results";
// Solo acepta el formato que genera el worker: 32 hex + .jpg
const SAFE_NAME = /^[a-f0-9]{32}\.jpg$/;

export default async function resultRoutes(fastify) {
  fastify.get("/results/:name", async (request, reply) => {
    const { name } = request.params;

    if (!SAFE_NAME.test(name)) {
      throw httpError(404, "No encontrado");
    }

    try {
      const image = await readFile(path.join(RESULTS_DIR, name));
      return reply
        .type("image/jpeg")
        .header("Cache-Control", "public, max-age=3600")
        .send(image);
    } catch (err) {
      if (err.code === "ENOENT") {
        throw httpError(404, "No encontrado");
      }
      throw err;
    }
  });
}