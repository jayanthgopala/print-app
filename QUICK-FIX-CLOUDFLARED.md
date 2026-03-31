# 🚀 QUICK FIX - Install Cloudflared

## The Error You're Getting:

```
Error: Cloudflared not installed.
Shop is offline or upload endpoint is not configured right now.
```

## The Solution (2 minutes):

### **Step 1: Install Cloudflared**

**Option A: Using PowerShell (Recommended)**

1. Right-click **PowerShell** → Select **"Run as Administrator"**

2. Run these commands:
```powershell
cd "c:\Users\jayanth gopala v\Desktop\APPLICATION V1.0\INSTALLER"
.\install-cloudflared.ps1
```

3. Wait for "Installation Complete!" ✅

---

**Option B: Using the Batch File**

1. Right-click **Command Prompt** → Select **"Run as Administrator"**

2. Run:
```cmd
cd "c:\Users\jayanth gopala v\Desktop\APPLICATION V1.0\INSTALLER"
install-cloudflared.bat
```

---

**Option C: Manual Installation**

1. Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe

2. Rename to: `cloudflared.exe`

3. Move to: `C:\Windows\System32\`

4. Test in Command Prompt:
   ```cmd
   cloudflared --version
   ```

---

### **Step 2: Restart PC App**

1. **Close** the PC Print Console app completely
2. **Open** it again
3. Enter your shop code and password
4. Click **"Save and Connect"**
5. Wait 10-15 seconds
6. Should show: **"🟢 Online (Auto-tunnel active)"** ✅

---

### **Step 3: Verify Frontend**

1. Open: https://print-app-87r.pages.dev/?shop=SHOP001
2. Should now say: **"Shop is online. You can upload files now."** ✅

---

## ✅ Quick Test

After installing, run this:

```cmd
cd "c:\Users\jayanth gopala v\Desktop\APPLICATION V1.0"
test-production-setup.bat
```

This will verify:
- ✅ Cloudflared installed
- ✅ Backend API reachable
- ✅ Shop status in database

---

## 🚨 Still Not Working?

### Check These:

1. **Cloudflared installed?**
   ```cmd
   cloudflared --version
   ```
   Should show version info

2. **PC app restarted?**
   - Must close completely and reopen

3. **Firewall blocking?**
   - Add cloudflared.exe to Windows Firewall exceptions

4. **Port 8788 available?**
   ```cmd
   netstat -ano | findstr :8788
   ```
   Should be empty or show PC app only

---

## 📞 Need Help?

If you get stuck, check:
- `pc-app/tunnel.log` - Tunnel activity
- Run: `node check-shop-status.js` - Database status

---

**Install cloudflared now and you'll be live in 2 minutes!** 🚀
