# DevHQ object storage (MinIO locally, S3 / R2 in production)

Owned by the STORAGE lane. `bootstrap.sh` makes a MinIO deployment match what
the backend expects. Re-running it is safe.

## Buckets

| Env var             | Default         | Purpose                         | Protection                                                                                                                           |
| ------------------- | --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `S3_BUCKET_UPLOADS` | `devhq-uploads` | user files (`pending/`, `files/`) | private, SSE, versioning; lifecycle: `pending/` expires after 1 day, noncurrent versions after 30 days, incomplete multipart after 1 day |
| `S3_BUCKET_BACKUPS` | `devhq-backups` | encrypted snapshots + manifests | Object Lock, default retention `BACKUP_RETENTION_DAYS` (35); expired by lifecycle, never by the app                                      |
| `S3_BUCKET_AUDIT`   | `devhq-audit`   | hash-chained audit batches      | Object Lock, default retention `AUDIT_RETENTION_DAYS` (365)                                                                           |
| `S3_BUCKET_MODELS`  | `devhq-models`  | ML model registry               | private, SSE, versioning                                                                                                             |

Lock mode is `STORAGE_LOCK_MODE`: **GOVERNANCE** in dev (an admin holding
`s3:BypassGovernanceRetention` can still clean up) and **COMPLIANCE** in prod
(nobody, root included, can delete or shorten retention before it expires).
Object Lock can only be switched on when a bucket is created. The script stops
if a WORM bucket already exists without it.

## Service users (least privilege)

| User (env)                | Policy          | Can                                                                                                                     |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `S3_ACCESS_KEY_ID`        | `devhq-backend` | uploads: get/put/delete/list · backups: put/get/list + read retention · audit: **put only** · explicit deny on delete, retention, legal hold, lifecycle and policy changes for backups/audit |
| `MODELS_S3_ACCESS_KEY_ID` | `devhq-models`  | models: get/put/delete/list. Nothing else.                                                                                |

The backend can read backups only because restore and the restore drill need
to. It cannot delete or overwrite them: versioning plus the lock keep the old
version.

Public access is blocked on every bucket (`mc anonymous set none`). Browsers
only ever get presigned URLs, valid for 10 minutes for uploads and 60 seconds
for downloads.

## Running it

```sh
docker run --rm --network <net> -v "$PWD/infra/minio:/bootstrap:ro" \
  -e MINIO_ENDPOINT=http://minio:9000 -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  -e S3_ACCESS_KEY_ID -e S3_SECRET_ACCESS_KEY \
  -e MODELS_S3_ACCESS_KEY_ID -e MODELS_S3_SECRET_ACCESS_KEY \
  --entrypoint /bin/sh cgr.dev/chainguard/minio-client:latest-dev /bootstrap/bootstrap.sh
```

`compose.snippet.yml` has the services for INFRA's compose file.

**Images:** `minio/minio` and `minio/mc` no longer pull anonymously from Docker
Hub (MinIO stopped publishing community images there), and `quay.io/minio/*`
returned 401 when tested. The e2e test used `cgr.dev/chainguard/minio` and
`cgr.dev/chainguard/minio-client:latest-dev`. Pin either by digest.

**SSE:** `mc encrypt set sse-s3` needs a KMS on the server. Set
`MINIO_KMS_SECRET_KEY=<name>:<base64 32 bytes>` (single static key, fine for
dev and small deployments) or run KES with a real KMS. `ENABLE_SSE=0` skips
encryption, for servers without a KMS only. Backups are also AES-256-GCM
encrypted by the app with `DATA_ENCRYPTION_KEY` before upload, so storage
encryption is a second layer.

**MinIO lifecycle quirk:** MinIO rejects `AbortIncompleteMultipartUpload` in a
rule that has no expiration action. The script folds it into an expiring rule,
which AWS also accepts. The script also pins `api stale_uploads_expiry=24h`.

## Browser access to presigned URLs (`S3_PUBLIC_ENDPOINT`)

The SigV4 signature covers the host, so presigned URLs must be signed for the
host the browser will use. The backend talks to `S3_ENDPOINT`
(`http://minio:9000`, internal) and signs browser URLs for
`S3_PUBLIC_ENDPOINT`, for example `https://files.devhq.example` routed by the
edge to `minio:9000` with the `Host` header preserved. MinIO answers CORS for
any origin by default. Restrict it at the edge or with `MINIO_API_CORS_ALLOW_ORIGIN`
to `APP_ORIGIN`. On AWS and R2, set the bucket CORS rule below.

---

## AWS S3 equivalents

Create the buckets with **Object Lock enabled at creation**
(`aws s3api create-bucket … --object-lock-enabled-for-bucket`) and turn on
**Block Public Access** (all four settings) at both account and bucket level.
Set the default retention with `put-object-lock-configuration`:

```json
{ "ObjectLockEnabled": "Enabled", "Rule": { "DefaultRetention": { "Mode": "COMPLIANCE", "Days": 35 } } }
```

Default encryption with a customer-managed KMS key (`put-bucket-encryption`):

```json
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:REGION:ACCOUNT:key/KEY-ID"
      },
      "BucketKeyEnabled": true
    }
  ]
}
```

The backend role's KMS key policy needs `kms:GenerateDataKey` and `kms:Decrypt`
on that key, and nothing else.

Backend IAM policy (attach to the backend's role; never use long-lived root keys):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::devhq-uploads/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": ["arn:aws:s3:::devhq-uploads", "arn:aws:s3:::devhq-backups"] },
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:GetObjectRetention"], "Resource": "arn:aws:s3:::devhq-backups/*" },
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::devhq-audit/*" },
    {
      "Effect": "Deny",
      "Action": [
        "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention",
        "s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:PutBucketObjectLockConfiguration",
        "s3:PutLifecycleConfiguration", "s3:PutBucketPolicy", "s3:DeleteBucket"
      ],
      "Resource": [
        "arn:aws:s3:::devhq-backups", "arn:aws:s3:::devhq-backups/*",
        "arn:aws:s3:::devhq-audit", "arn:aws:s3:::devhq-audit/*"
      ]
    }
  ]
}
```

Bucket policy for every bucket (deny anything that isn't TLS, and on the WORM
buckets deny any principal other than the backend role and the break-glass
admin role):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::devhq-backups", "arn:aws:s3:::devhq-backups/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "OnlyBackendAndBreakGlass",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::devhq-backups", "arn:aws:s3:::devhq-backups/*"],
      "Condition": {
        "ArnNotLike": {
          "aws:PrincipalArn": [
            "arn:aws:iam::ACCOUNT:role/devhq-backend",
            "arn:aws:iam::ACCOUNT:role/devhq-break-glass"
          ]
        }
      }
    }
  ]
}
```

Lifecycle for uploads (`put-bucket-lifecycle-configuration`) is the same JSON
`bootstrap.sh` imports. Keep backups and audit in a **separate AWS account**
from the app's runtime if you can, so a compromise of the app account can't
touch the recovery points.

Uploads bucket CORS:

```json
[
  {
    "AllowedOrigins": ["https://app.devhq.example"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

## Cloudflare R2 equivalents

- Endpoint: `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
  `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`. The SigV4 signer works
  unchanged.
- **Credentials:** create R2 API tokens scoped to the specific buckets: Object
  Read & Write for the uploads token, Object Read & Write for backups/audit.
  R2 tokens can't express "put but never delete", so rely on the lock rules
  below for WORM.
- **WORM:** R2 *Bucket Locks* block deletion and overwrite for the retention
  period, for every API token. Unlike S3 COMPLIANCE, an account member with R2
  admin rights can remove the rule, so set `STORAGE_LOCK_MODE=R2_BUCKET_LOCK`
  (reported as such by the API). `infra/railway/r2-setup.sh` applies the rules;
  guarantees and controls: [WORM on R2](../../docs/deploy/RAILWAY.md#worm-on-r2).
- **Encryption:** R2 encrypts every object at rest with AES-256. There are no
  customer-managed keys, which is why the app encrypts backups with
  `DATA_ENCRYPTION_KEY` before uploading.
- **Lifecycle:** R2 object lifecycle rules support age-based deletion by
  prefix (`pending/` → 1 day) and aborting incomplete multipart uploads.
- **Public access:** leave the bucket's public r2.dev URL and custom domains
  **disabled**. Use presigned URLs only, and set CORS as above.
