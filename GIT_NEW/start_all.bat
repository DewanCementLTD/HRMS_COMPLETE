@echo off
echo ============================================================
echo  LMS Server Launcher
echo ============================================================
echo.

:: -- Step 0: Locate the deployment -----------------------------
:: ROOT is the folder this .bat lives in (%~dp0, trailing slash stripped), so
:: the launcher follows the code instead of pointing at wherever it was first
:: deployed. The previous version hard-coded C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW,
:: which does not exist on this machine -- every "start" line silently cd'd
:: nowhere and the windows died on "npm is not recognized" / "can't open file".
:: DATA_ROOT is separate on purpose: EMP_DOCS / COMP_LOGO are uploaded payroll
:: documents and company logos, NOT source, so they live outside the git tree.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DATA_ROOT=C:\Software\HRMS_LMS_APP"
set "VENV=%ROOT%\LMS-Backend\.venv"

:: These must be set HERE, not in a .env file. LMS-Backend\AI\config.py reads
:: EMP_DOCS_ROOT from os.environ at line 25, before _load_env_file() runs at
:: line 47, and repositories\document_repository.py reads it at import time --
:: neither ever sees AI\.env. Child windows inherit these, so setting them once
:: in the launcher covers the FastAPI backend, the CV watcher and the face
:: service.
:: Without them the code falls back to C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS,
:: which is the OLD box's path and does not exist on this machine.
set "EMP_DOCS_ROOT=%DATA_ROOT%\EMP_DOCS"
set "COMP_LOGO_ROOT=%DATA_ROOT%\COMP_LOGO"

echo Deployment root: %ROOT%
echo Data root:       %DATA_ROOT%
echo.

:: -- Step 1: Kill any existing Node backend (if running) -------
:: Also kill any old FastAPI process (run_8001.bat / serve.py) in case
:: someone was using it before we switched to Node backend.
:: The "-notmatch 'powershell'" guard prevents the helper powershell process
:: from killing itself before it finishes reporting the other PIDs.

echo [1/5] Stopping existing backends (Node and FastAPI)...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Node-LMS-Backend' -and $_.CommandLine -match 'index.js' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing Node backend PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run_8001' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing FastAPI restart-loop PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing FastAPI serve.py PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 2: Kill anything holding ports 3000, 8002, 8003 ------
:: Port 8001 (FastAPI) is no longer used since we switched to Node backend.
:: Kill processes on port 8003 (Node backend), 8002 (Face), and 3000 (Frontend)
:: to ensure clean startup.

echo [2/5] Stopping existing processes on ports 3000, 8002, 8003...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 3000
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8002 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8002
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8003 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8003
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 3: Kill any running CV watcher so we don't run two ---
:: The watcher has no port; two copies would both grab CV_Buffer files and
:: double-process them. Kill the old one before starting a fresh window.

echo [3/5] Stopping existing CV watcher (if any)...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'cv_watcher\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing CV watcher PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 4: Wait for ports to fully release -------------------

echo [4/5] Waiting 4 seconds for ports to clear...
timeout /t 4 /nobreak >nul

:: -- Preflight: fail loudly here instead of in child windows ---
:: Each "start" below opens its own console, so a missing venv or a missing
:: node_modules shows up as an error scrolling past in a window nobody is
:: watching.

set "PREFLIGHT_FAIL="
if not exist "%VENV%\Scripts\python.exe" (
    echo   [MISSING] Python venv: %VENV%
    echo             Create it:  C:\Python310\python.exe -m venv "%VENV%"
    set "PREFLIGHT_FAIL=1"
)
if not exist "%ROOT%\LMS-Web\node_modules" (
    echo   [MISSING] Web deps:  %ROOT%\LMS-Web\node_modules  -- run: npm install
    set "PREFLIGHT_FAIL=1"
)
if not exist "%ROOT%\Node-LMS-Backend\node_modules" (
    echo   [MISSING] Node backend deps:  %ROOT%\Node-LMS-Backend\node_modules  -- run: npm install
    set "PREFLIGHT_FAIL=1"
)
if defined PREFLIGHT_FAIL (
    echo.
    echo  Fix the items above, then re-run this launcher.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Starting servers...
echo ============================================================
echo.

:: -- LMS Backend (Node.js, port 8003) --------------------------
:: Serves ALL API calls: auth, hrms, payroll, reports, recruitment, etc.
:: Node backend includes ALL endpoints (Reports, Payroll, HRMS, etc.)
:: The .env in Node-LMS-Backend is already configured for the database.
echo Starting LMS Backend on port 8003 (Node.js)...
start "LMS Backend (Node)" cmd /k "cd /d %ROOT%\Node-LMS-Backend && npm start"

:: -- CV Recruitment Watcher (AI pipeline, no port) ------------
:: Watches AI\Recruitment\<company>\CV_Buffer\<job>\ for dropped CV PDFs,
:: extracts + LLM-evaluates each one and persists it to the recruitment DB
:: (candidate -> application -> evaluation). Uses the SAME .venv as the backend.
:: Runs from the AI folder because the pipeline modules import each other by
:: bare name (config, cv_extractor, ...). Leave this window open while HR uploads CVs.
echo Starting CV Recruitment Watcher (AI screening)...
start "CV Watcher" cmd /k "cd /d %ROOT%\LMS-Backend\AI && call %VENV%\Scripts\activate.bat && python cv_watcher.py"

:: -- Face Recognition Backend (FastAPI, port 8002) ------------
:: Shares the backend venv (insightface/onnxruntime are installed there), so
:: face_rec\venv310 from the old box is not used.
echo Starting Face Backend on port 8002...
start "Face Backend" cmd /k "cd /d %ROOT%\LMS-Face-Backend\face_rec && %VENV%\Scripts\python.exe -m uvicorn api:app --host 0.0.0.0 --port 8002"

:: -- Next.js Frontend (port 3000) -----------------------------
:: LMS-Web\next.config.ts rewrites /api/* to BACKEND_URL (from .env)
:: which is now set to Node backend on 127.0.0.1:8003
:: IMPORTANT: build BEFORE start so the served .next is always fresh and
:: consistent. "&&" means npm run start only runs if the build succeeds -- if the
:: build fails, this window stays open showing the error instead of serving a
:: stale/broken build (which is what causes ChunkLoadError in the browser).
echo Starting Frontend on port 3000 (building first, please wait)...
start "LMS Frontend" cmd /k "cd /d %ROOT%\LMS-Web && echo ===== Building frontend (npm run build) ===== && npm run build && echo ===== Build OK - starting (npm run start) ===== && npm run start"

echo.
echo All servers started in separate windows.
echo.
echo  NOTE: the Frontend window builds first (~15-30s) before it serves.
echo  Wait for "Build OK - starting" in that window before opening the app,
echo  then hard-refresh the browser (Ctrl+Shift+R) to drop any cached chunks.
echo.
echo  ✅ Node.js Backend is now the primary API server:
echo     - Serves ALL endpoints: auth, hrms, payroll, reports, recruitment, etc.
echo     - Reports page (/api/reports/*) is now fully functional
echo     - All features (attendance, documents, face, location) work correctly
echo.
echo  Servers running:
echo  -----------------
echo  Node Backend:   http://localhost:8003 - ALL API endpoints (auth, reports, payroll, etc.)
echo  Face API:       http://localhost:8002 - Face recognition
echo  Frontend:       http://localhost:3000 - Web application
echo  CV Watcher:     (no port) - AI CV screening, see the "CV Watcher" window
echo.
pause
