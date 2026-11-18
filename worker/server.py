"""Worker de inferencia YOLO.

Servicio interno (no expuesto al host) que carga el modelo una sola vez y
responde a POST /infer. La API Node le reenvía la imagen y él devuelve el JSON
de detecciones, guardando la imagen anotada en el volumen compartido /data.
"""

import hashlib
import io
import json
import os
import re
import threading
import uuid
from pathlib import Path

import cv2
from flask import Flask, jsonify, request
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

MODEL_NAME = os.getenv("YOLO_MODEL", "yolo11n.pt")
MODELS_DIR = Path(os.getenv("MODELS_DIR", "/models"))
RESULTS_DIR = Path(os.getenv("RESULTS_DIR", "/data/results"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "15"))
DEFAULT_CONF = float(os.getenv("YOLO_CONF", "0.25"))
DEVICE = os.getenv("YOLO_DEVICE", "cpu")

MODELS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Si el modelo no está en /models, Ultralytics lo descarga la primera vez y
# queda persistido en el volumen.
_model_path = MODELS_DIR / MODEL_NAME
model = YOLO(str(_model_path) if _model_path.exists() else MODEL_NAME)
if not _model_path.exists() and Path(MODEL_NAME).exists():
    Path(MODEL_NAME).replace(_model_path)
    model = YOLO(str(_model_path))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# Ruta real del checkpoint (puede ser el volumen o la caché de Ultralytics).
_resolved_path = _model_path if _model_path.exists() else None
if _resolved_path is None:
    _ckpt = getattr(model, "ckpt_path", None)
    if _ckpt and Path(_ckpt).exists():
        _resolved_path = Path(_ckpt)

def _train_number(ckpt) -> int | None:
    """Extrae el número de entrenamiento del checkpoint (train56 -> 56)."""
    if not isinstance(ckpt, dict):
        return None
    train_args = ckpt.get("train_args")
    if not isinstance(train_args, dict):
        return None
    for key in ("name", "model", "project"):
        match = re.search(r"train(\d+)", str(train_args.get(key) or ""))
        if match:
            return int(match.group(1))
    return None


MODEL_HASH = _sha256(_resolved_path) if _resolved_path else None
MODEL_CLASSES = {
    str(key): value for key, value in (getattr(model, "names", {}) or {}).items()
}
MODEL_TRAIN = _train_number(getattr(model, "ckpt", None))
MODEL_SHORT_HASH = (MODEL_HASH or "0000")[-4:].upper()
MODEL_VERSION_NAME = f"{MODEL_TRAIN if MODEL_TRAIN is not None else 0}_{MODEL_SHORT_HASH}"


def model_metadata() -> dict:
    """Identidad y versión legible del modelo para trazabilidad."""
    return {
        "file": MODEL_NAME,
        "path": str(_resolved_path or _model_path),
        "sha256": MODEL_HASH,
        "train_number": MODEL_TRAIN,
        "short_hash": MODEL_SHORT_HASH,
        "name": MODEL_VERSION_NAME,
        "num_classes": len(MODEL_CLASSES),
        "classes": MODEL_CLASSES,
    }


# La inferencia de YOLO no es segura para ejecutarse en paralelo sobre el
# mismo modelo: serializamos las peticiones.
_lock = threading.Lock()

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(status="ok", model=MODEL_NAME, device=DEVICE)


@app.get("/model")
def model_info():
    return jsonify(model_metadata())


@app.post("/infer")
def infer():
    if "file" not in request.files:
        return jsonify(detail="Falta el archivo"), 400

    upload = request.files["file"]
    data = upload.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify(detail=f"La imagen supera {MAX_UPLOAD_MB} MB"), 413

    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        return jsonify(detail="El archivo no es una imagen válida"), 400

    try:
        conf_minima = float(request.form.get("conf_minima", DEFAULT_CONF))
    except (TypeError, ValueError):
        return jsonify(detail="conf_minima inválida"), 400
    if not (0.0 < conf_minima <= 1.0):
        return jsonify(detail="conf_minima debe estar entre 0 y 1"), 400

    with _lock:
        results = model.predict(img, conf=conf_minima, device=DEVICE, verbose=False)
    result = results[0]

    detections = json.loads(result.to_json())
    annotated_bgr = result.plot()
    out_id = uuid.uuid4().hex
    cv2.imwrite(str(RESULTS_DIR / f"{out_id}.jpg"), annotated_bgr)

    height, width = result.orig_shape

    return jsonify(
        id=out_id,
        image_url=f"/results/{out_id}.jpg",
        width=width,
        height=height,
        count=len(detections),
        detections=detections,
        model=model_metadata(),
    )


@app.errorhandler(Exception)
def handle_error(error):
    app.logger.exception("error inesperado en el worker", exc_info=error)
    return jsonify(detail="Error interno del servicio de inferencia"), 500


if __name__ == "__main__":
    from waitress import serve

    serve(app, host="0.0.0.0", port=9000, threads=4)