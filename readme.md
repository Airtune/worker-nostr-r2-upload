Cloudflare Workers KV
https://developers.cloudflare.com/workers/runtime-apis/kv/#kv
https://developers.cloudflare.com/workers/get-started/guide/

# Set up a Cloudflare Worker

## 1) Create R2 bucket

Source: https://developers.cloudflare.com/r2/get-started/

Go to CloudFlare dashboard and create an R2 Bucket:
https://dash.cloudflare.com

or create the bucket using the command:

```
npx wrangler r2 bucket create <BUCKET_NAME>
```

Check that the bucket is created:

```
npx wrangler r2 bucket list
```

## 2) Create worker

Source: https://developers.cloudflare.com/workers/get-started/quickstarts/

```
npx wrangler generate <NEW_PROJECT_NAME> <GITHUB_REPO_URL>
```

TODO: insert GITHUB_REPO_URL for `worker-nostr-r2-upload`

## 3) Bind bucket to worker

Source: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/#3-bind-your-bucket-to-a-worker

Find your account id:

```
npx wrangler whoami
```

Set the account id in `wrangler.toml` for your worker:

```
account_id = "YOUR_ACCOUNT_ID"
```

Set the R2 bucket bindings.

```
[[r2_buckets]]
binding = 'MY_BUCKET' # <~ valid JavaScript variable name
bucket_name = '<YOUR_BUCKET_NAME>'
```


