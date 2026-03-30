# Production-Level Tunnel Installation Guide

## Automated Tunnel Setup (No Command Prompt Needed!)

The PC app now **automatically manages** the Cloudflare tunnel. Customers don't need to run any commands!

---

## 🚀 Quick Setup (One-Time Installation)

### Step 1: Install Cloudflared

#### **Windows:**

1. Download cloudflared:
   - Visit: https://github.com/cloudflare/cloudflared/releases/latest
   - Download: `cloudflared-windows-amd64.exe`

2. Rename and move:
   ```cmd
   rename cloudflared-windows-amd64.exe cloudflared.exe
   move cloudflared.exe C:\Windows\System32\
   ```

3. Verify installation:
   ```cmd
   cloudflared --version
   ```

#### **Alternative: Using Chocolatey**
```cmd
choco install cloudflared
```

#### **Alternative: Using winget**
```cmd
winget install --id Cloudflare.cloudflared
```

---

### Step 2: That's It!

Once cloudflared is installed:

1. ✅ Open the PC Print Console app
2. ✅ Enter shop code and password
3. ✅ Click "Save and Connect"
4. ✅ **Tunnel starts automatically!**

The app will:
- 🔄 Auto-start the tunnel
- 🔗 Auto-detect the tunnel URL
- 📡 Auto-update the backend
- ♻️ Auto-reconnect if disconnected

---

## 🎯 How It Works (For Customers)

### **Before (Old Way) ❌**
1. Open Command Prompt
2. Run tunnel command
3. Copy URL
4. Open PC app
5. Paste URL
6. Click connect
7. Keep Command Prompt open

### **After (New Way) ✅**
1. Open PC app
2. Click "Save and Connect"
3. **Done!**

---

## 📊 Visual Status Indicators

The PC app now shows:

- 🟢 **"Online (Auto-tunnel active)"** - Tunnel running automatically
- 🔵 **"Starting tunnel..."** - Tunnel initializing
- 🟢 **"Tunnel connected: https://..."** - Success with URL
- 🔴 **"Tunnel error: ..."** - Problem detected

---

## 🛡️ Production Features

### Auto-Reconnect
If the tunnel disconnects:
- ✅ Automatically retries (up to 5 times)
- ✅ Waits 5 seconds between attempts
- ✅ Updates backend with new URL
- ✅ Notifies user of status

### Background Operation
- ✅ Runs in background (no Command Prompt)
- ✅ Survives app minimize
- ✅ Clean shutdown on app close
- ✅ Logs all activity to `tunnel.log`

### Backwards Compatible
- ✅ Manual URL still works (optional)
- ✅ Legacy .env file supported
- ✅ Gradual migration path

---

## 🔧 Troubleshooting

### "Cloudflared not installed" Error

**Solution:**
1. Install cloudflared (see Step 1 above)
2. Restart the PC app
3. Try connecting again

### "Failed to start tunnel" Error

**Possible causes:**
1. **Port 8788 already in use**
   - Close other apps using the port
   - Or change port in PC app settings

2. **Firewall blocking cloudflared**
   - Add cloudflared to Windows Firewall exceptions
   - Allow outbound connections on port 443

3. **No internet connection**
   - Check your network
   - Tunnel requires internet to work

### Tunnel keeps reconnecting

**This is normal!** Quick tunnels can be unstable. For production:

1. **Use a Named Tunnel** (recommended):
   ```cmd
   cloudflared login
   cloudflared tunnel create my-print-shop
   ```

2. Configure in PC app `.env`:
   ```
   UPLOAD_PUBLIC_URL=https://your-domain.com
   ```

---

## 📁 Log Files

Check logs if something goes wrong:

- **Tunnel logs:** `pc-app/tunnel.log`
- **App logs:** Check the main app log file

---

## 🔄 Manual Override (Optional)

If you prefer manual tunnel management:

1. Set `UPLOAD_PUBLIC_URL` in `pc-app/.env`
2. Or enter URL in the PC app's "Upload Public URL" field
3. The app will use your manual URL instead of auto-tunnel

---

## 📦 For the Installer

Include in your installer package:

```batch
@echo off
echo Installing Cloudflared...

REM Download cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe

REM Move to System32
move /Y cloudflared.exe C:\Windows\System32\cloudflared.exe

REM Verify
cloudflared --version

echo Cloudflared installed successfully!
pause
```

---

## ✅ Deployment Checklist

For each PC deployment:

- [ ] Install cloudflared
- [ ] Install PC Print Console app
- [ ] Enter shop code and password
- [ ] Click "Save and Connect"
- [ ] Verify status shows "Online"
- [ ] Test upload from frontend

That's it! No technical knowledge required.

---

## 🎓 Training Customers

### Simple Instructions:

**"How do I use the print system?"**

1. Install the PC app
2. Enter your shop code and password
3. Click "Save and Connect"
4. When it says "Online", you're ready!
5. Share your QR code with customers

**That's all they need to know!** ✨

---

## 🔐 Security Notes

- Quick tunnels are encrypted (HTTPS)
- Each tunnel URL is unique
- URLs change on restart (for security)
- Named tunnels provide stable URLs
- Authentication via tokens (no exposed credentials)

---

## 💡 Pro Tips

1. **First deployment?** Test locally first!
2. **Multiple shops?** Each gets its own tunnel
3. **Internet down?** Offline mode coming soon
4. **Need support?** Check `tunnel.log` first

---

## 🆘 Support

If customers have issues:

1. Check cloudflared is installed: `cloudflared --version`
2. Check `tunnel.log` for errors
3. Try restarting the PC app
4. Check firewall settings
5. Verify internet connection

---

**This makes your print shop system truly production-ready!** 🎉

No more asking customers to run commands. Just install and go!
