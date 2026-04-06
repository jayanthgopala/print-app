Set these from `C:\Users\jayanth gopala v\Desktop\APPLICATION V1.0\backend`.

`wrangler secret put DATABASE_URL`
`wrangler secret put JWT_SECRET`
`wrangler secret put R2_ACCOUNT_ID`
`wrangler secret put R2_BUCKET_NAME`
`wrangler secret put R2_ACCESS_KEY_ID`
`wrangler secret put R2_SECRET_ACCESS_KEY`

Set these in `wrangler.toml` vars or Cloudflare dashboard vars:

`FRONTEND_URL`
`ADMIN_FRONTEND_URL`
`ALLOWED_ORIGINS`

Recommended values:

`DATABASE_URL=postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-1-[YOUR-REGION].pooler.supabase.com:6543/postgres`
`FRONTEND_URL=https://your-frontend-url`
`ADMIN_FRONTEND_URL=https://your-admin-frontend-url`
`ALLOWED_ORIGINS=https://your-frontend-url,https://your-admin-frontend-url`
`R2_BUCKET_NAME=printapp`

Generate strong secrets:

PowerShell:
`[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))`

Use that output for:

`JWT_SECRET`

Do not put the admin login password in `.env`, `.dev.vars`, or Worker secrets.
The admin login password should exist only in PostgreSQL as a password hash.
