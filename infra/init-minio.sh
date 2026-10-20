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

# Anonymous read of objects only. The canned `public` policy is read-write,
# and `download` also lets anyone list every key in the bucket.
set_public_read() {
  printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}' "$1" > "/tmp/$1-policy.json"
  mc anonymous set-json "/tmp/$1-policy.json" "minio/$1"
}

set_public_read equations
set_public_read videos

echo "MinIO initialization complete!"
