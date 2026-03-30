# Cloudflare Tunnel Setup Guide

## Problem
Your PC app shows "ONLINE" but the frontend says "Shop is offline" because the tunnel URL is not configured.

## Quick Fix Steps

### Step 1: Start the Cloudflare Tunnel

Open a **new Command Prompt** window and run:

```cmd
cd "c:\Users\jayanth gopala v\Desktop\APPLICATION V1.0\pc-app"
cloudflared tunnel --url http://localhost:8788
```

Wait 10-15 seconds until you see a message like:
```
|  Your quick Tunnel has been created! Visit it at:  |
|  https://xxxxx-xxxxx-xxxxx.trycloudflare.com       |
```

**Copy the tunnel URL** (the `https://...` line).

### Step 2: Configure the PC App

1. Open your **PC Print Console** app
2. Stop the service if it's running
3. In the "Control Desk" section, you'll now see a **"Upload Public URL"** field
4. Paste the tunnel URL you copied in Step 1
5. Click "Save and Connect"

### Step 3: Verify

1. Check that the PC app shows "SERVICE STATUS: ONLINE"
2. Open your frontend: https://print-app-87r.pages.dev/?shop=SHOP001
3. It should now show "Shop is online. You can upload files now."

## Permanent Setup (Recommended)

For production use, set up a **named tunnel** instead of quick tunnels:

1. Login to Cloudflare:
   ```cmd
   cloudflared login
   ```

2. Create a named tunnel:
   ```cmd
   cloudflared tunnel create print-shop-tunnel
   ```

3. Create a config file `config.yml`:
   ```yaml
   tunnel: print-shop-tunnel
   credentials-file: C:\Users\jayanth gopala v\.cloudflared\<tunnel-id>.json
   
   ingress:
     - hostname: print-shop.yourdomain.com
       service: http://localhost:8788
     - service: http_status:404
   ```

4. Route the tunnel:
   ```cmd
   cloudflared tunnel route dns print-shop-tunnel print-shop.yourdomain.com
   ```

5. Run the tunnel:
   ```cmd
   cloudflared tunnel run print-shop-tunnel
   ```

## Alternative: Update .env File

You can also set the tunnel URL in the `.env` file:

1. Edit `pc-app\.env`
2. Add or update:
   ```
   UPLOAD_PUBLIC_URL=https://your-tunnel-url.trycloudflare.com
   UPLOAD_PORT=8788
   ```

## Troubleshooting

### "Shop is still offline"

1. Check the tunnel is running: Open the tunnel URL in your browser
2. Check PC app is online: Should show green "ONLINE" status
3. Check browser console for errors: Open DevTools (F12) and check Console tab
4. Verify shop code matches: Use the exact shop code from PC app

### "Cannot reach tunnel URL"

1. Make sure cloudflared is running
2. Check that port 8788 is not blocked by firewall
3. Restart the PC app after setting tunnel URL

### "Tunnel URL keeps changing"

Quick tunnels change every time you restart cloudflared. Use a **named tunnel** (see Permanent Setup above) for a stable URL.

## Additional Notes

- The tunnel URL must be accessible from the internet
- The PC app must be running for uploads to work
- The tunnel must point to `http://localhost:8788` (or your configured port)
- Keep the cloudflared process running in the background
