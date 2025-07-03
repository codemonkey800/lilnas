#!/bin/bash

# Wait for MinIO to be ready
echo "Waiting for MinIO to be ready..."
until mc alias set minio http://storage:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}; do
  echo "MinIO not ready yet, waiting..."
  sleep 2
done

echo "MinIO is ready, setting up buckets and policies..."

# Create equations bucket if it doesn't exist
mc mb minio/equations --ignore-existing

# Create videos bucket if it doesn't exist
mc mb minio/videos --ignore-existing

# Set public read policy for equations bucket
mc anonymous set public minio/equations

# Set public read policy for videos bucket
mc anonymous set public minio/videos

echo "MinIO initialization complete!"
