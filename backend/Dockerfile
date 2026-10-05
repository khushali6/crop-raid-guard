# Crop Raid Guard API + worker for Hugging Face Spaces (free CPU Docker Space) or any container host.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HOME=/home/user PATH=/home/user/.local/bin:$PATH PORT=7860

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 user

USER user
WORKDIR /home/user/app

# CPU-only PyTorch keeps the image small enough for free hosting.
RUN pip install --user torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY --chown=user pyproject.toml ./
COPY --chown=user app ./app
RUN pip install --user ".[vision]"

# Bake the SpeciesNet weights into the image so cold starts do not re-download ~200 MB.
ARG SPECIESNET_MODEL=kaggle:google/speciesnet/pyTorch/v4.0.3a/1
ENV SPECIESNET_MODEL=${SPECIESNET_MODEL}
RUN python -c "import os; from speciesnet import SpeciesNet; SpeciesNet(os.environ['SPECIESNET_MODEL'], components='all', geofence=True)"

COPY --chown=user kb ./kb

EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
