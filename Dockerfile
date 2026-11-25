FROM python:3.13-alpine
WORKDIR /srv
COPY server.py SailLens.html ./
ENV PYTHONDONTWRITEBYTECODE=1 SAILLENS_DATA_DIR=/data
CMD ["python", "server.py"]
