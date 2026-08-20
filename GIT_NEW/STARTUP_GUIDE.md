# LMS Application - Startup Guide

## Quick Start

### Option 1: Backend Only (Recommended for API Development)
```bash
start_backend_only.bat
```
Starts:
- FastAPI Backend (port 8001) - API Docs at http://localhost:8001/docs
- Face Recognition API (port 8002)
- CV Recruitment Watcher

### Option 2: Full Stack (With Frontend)
```bash
start_all.bat
```
Starts:
- FastAPI Backend (port 8001)
- Face Recognition API (port 8002)
- CV Recruitment Watcher
- Next.js Frontend (port 3000)

Note: Frontend takes 15-30 seconds to build on first run.

---

## Services & Ports

| Service | Port | Purpose |
|---------|------|---------|
| FastAPI Backend | 8001 | API Gateway, Auth, HR, HRMS, Payroll, Attendance, Recruitment |
| Face Recognition | 8002 | Facial recognition & verification |
| Frontend (Next.js) | 3000 | Web UI (optional, use start_all.bat) |
| CV Watcher | N/A | Background CV screening and AI evaluation |

---

## Common Tasks

### Test Backend API
Open: `http://localhost:8001/docs`

### Check API Status
```powershell
Invoke-WebRequest http://localhost:8001/health -Verbose
```

### View Face API Endpoints
Open: `http://localhost:8002/docs`

### Monitor CV Watcher
Watch the "CV Watcher" console window for processing logs.

---

## Environment Configuration

All paths are automatically resolved relative to the launcher location. Key paths:
- **Deployment Root**: `c:\ERP_SYSTEMS\HRMS_LMS_APP\GIT_NEW`
- **Python Venv**: `LMS-Backend\.venv`
- **Data Root**: `C:\Software\HRMS_LMS_APP`

### Environment Variables (Auto-set by launcher)
- `EMP_DOCS_ROOT` → `C:\Software\HRMS_LMS_APP\EMP_DOCS`
- `COMP_LOGO_ROOT` → `C:\Software\HRMS_LMS_APP\COMP_LOGO`

---

## Troubleshooting

### Issue: Face Backend fails with path error
**Solution**: The launcher auto-kills old processes. If you still see path errors:
1. Close all CMD/PowerShell windows
2. Kill Python processes: `taskkill /F /IM python.exe`
3. Run launcher again

### Issue: Port already in use
**Solution**: The launcher auto-kills processes holding the ports. If that fails:
```powershell
# Kill specific port
$pid = (Get-NetTCPConnection -LocalPort 8001).OwningProcess
Stop-Process -Id $pid -Force
```

### Issue: Requirements not found
**Solution**: Requirements files must be in UTF-8 format. They are auto-converted by the launcher.

### Issue: Frontend not loading after changes
**Solution**: 
1. Close the "LMS Frontend" window
2. Delete `LMS-Web\.next` folder
3. Run `start_all.bat` again
4. Hard-refresh browser: `Ctrl+Shift+R`

---

## Project Structure

```
LMS_APP/
├── LMS-Backend/              # FastAPI Backend
│   ├── .venv/                # Python virtual environment
│   ├── AI/                   # CV Watcher & AI Screening
│   ├── serve.py              # Uvicorn server wrapper
│   └── run_8001.bat           # Auto-restart wrapper
├── LMS-Face-Backend/         # Face Recognition Service
│   └── face_rec/
│       ├── api.py            # FastAPI routes
│       └── face_login.py      # Face recognition logic
├── LMS-Web/                  # Next.js Frontend (optional)
│   ├── node_modules/
│   ├── src/                  # React components
│   └── next.config.ts        # API routing config
├── start_all.bat             # Full stack launcher
├── start_backend_only.bat    # Backend-only launcher
└── START_LMS.bat             # Legacy launcher (same as start_all.bat)
```

---

## Fixed Issues (2026-08-10)

1. ✓ **Face Backend Path Error**
   - Removed stale processes referencing old path `C:\ERP_SYSTEMS\HRMS_COMPLETE\`
   - Verified venv is at correct location

2. ✓ **Requirements Files**
   - Converted main requirements.txt from UTF-16 LE to UTF-8
   - Removed duplicate insightface reference in Face Backend
   - Verified AI requirements format

3. ✓ **Node Backend Removed**
   - Created `start_backend_only.bat` for API-only operation
   - Maintained `start_all.bat` for full stack with frontend

---

## Support

All server outputs visible in their respective console windows. Check window titles:
- "LMS Backend" - FastAPI server output
- "Face Backend" - Face recognition service output
- "CV Watcher" - CV screening and AI evaluation logs
- "LMS Frontend" - Next.js build and server logs

Check these windows for error messages if services fail to start.
