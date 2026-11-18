FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

# Librerías del sistema que necesita OpenCV.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# PyTorch versión CPU (mucho más ligera). Para GPU, cambia TORCH_INDEX.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install torch torchvision --index-url ${TORCH_INDEX}

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY server.py .

RUN mkdir -p /models /data/results
VOLUME ["/models", "/data"]

EXPOSE 9000

CMD ["python", "server.py"]