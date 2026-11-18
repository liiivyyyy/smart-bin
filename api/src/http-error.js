/** Crea un Error con statusCode para que el handler global responda { detalle }. */
export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}