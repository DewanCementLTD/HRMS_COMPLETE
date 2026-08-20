@echo off
:: NOTE: this is now functionally identical to start_all.bat -- both start only
:: FastAPI (8001), the CV watcher, the face service (8002), and the frontend
:: (3000); neither starts Node-LMS-Backend. Kept as a separate file in case you
:: want a lighter preflight (no node_modules check) or want to diverge the two
:: later; otherwise start_all.bat is the one to use.
echo ============================================================
echo  LMS Server Launcher
echo ============================================================
echo.

:: Paths resolve from this script's own folder (%~dp0) -- see start_all.bat for
:: why, and for what EMP_DOCS_ROOT / COMP_LOGO_ROOT are doing here rather than
:: in a .env file.
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DATA_ROOT=C:\Software\HRMS_LMS_APP"
set "VENV=%ROOT%\LMS-Backend\.venv"
set "EMP_DOCS_ROOT=%DATA_ROOT%\EMP_DOCS"
set "COMP_LOGO_ROOT=%DATA_ROOT%\COMP_LOGO"

echo Deployment root: %ROOT%
echo Data root:       %DATA_ROOT%
echo.

:: -- Step 1: Kill the backend auto-restart loop FIRST ---------
:: run_8001.bat is a watchdog: it relaunches serve.py 3 seconds after it
:: exits, forever. If we only killed the process LISTENING on 8001, this
:: loop would respawn serve.py while we start a fresh backend and the port
:: bind would fail with WinError 10048. Kill the loop (cmd running
:: run_8001.bat) and any serve.py python BEFORE freeing the ports.
::
:: NOTE: this used to shell out to wmic.exe, which does not exist on this
:: server (Windows Server 2025 dropped the wmic CLI). Get-CimInstance talks to
:: the same underlying WMI service and is still present, so it's the
:: replacement. The "-notmatch 'powershell'" guard stops the helper
:: powershell.exe process from matching its OWN command line (it literally
:: contains "run_8001") and killing itself before it reports the other PIDs.

echo [1/4] Stopping backend auto-restart loop (run_8001.bat / serve.py)...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run_8001' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing restart-loop PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing serve.py PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 2: Kill anything holding ports 3000, 8001, 8002 -----

echo [2/4] Stopping existing processes on ports 3000, 8001, 8002...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 3000
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8001
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8002 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8002
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 3: Kill any running CV watcher so we don't run two ---
:: The watcher has no port; two copies would both grab CV_Buffer files and
:: double-process them. Kill the old one before starting a fresh window.

echo [3/4] Stopping existing CV watcher (if any)...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'cv_watcher\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing CV watcher PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 4: Wait for ports to fully release -------------------

echo [4/4] Waiting 4 seconds for ports to clear...
timeout /t 4 /nobreak >nul

if not exist "%VENV%\Scripts\python.exe" (
    echo.
    echo   [MISSING] Python venv: %VENV%
    echo             See start_all.bat for how to recreate it.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Starting servers...
echo ============================================================
echo.

:: -- LMS Backend (FastAPI, port 8001) -------------------------
:: Serves BOTH the mobile clients and the web app's /api/* calls (see
:: LMS-Web\next.config.ts) -- Node-LMS-Backend is not started here.
:: Started via run_8001.bat, NOT plain uvicorn:
::  - serve.py runs uvicorn on a SelectorEventLoop, fixing the Windows bug
::    where a dropped connection (WinError 64) silently closes the listening
::    socket and the port dies until someone restarts the process.
::  - the bat loop auto-restarts the server if it ever crashes.
:: Step 1 above kills any previous copy of this loop, so re-running this
:: launcher never fights itself for port 8001.
echo Starting LMS Backend on port 8001...
start "LMS Backend" cmd /k "cd /d %ROOT%\LMS-Backend && call %ROOT%\LMS-Backend\run_8001.bat"

:: -- CV Recruitment Watcher (AI pipeline, no port) ------------
:: Watches AI\Recruitment\<company>\CV_Buffer\<job>\ for dropped CV PDFs,
:: extracts + LLM-evaluates each one and persists it to the recruitment DB
:: (candidate -> application -> evaluation). Uses the SAME .venv as the backend.
:: Runs from the AI folder because the pipeline modules import each other by
:: bare name (config, cv_extractor, ...). Leave this window open while HR uploads CVs.
echo Starting CV Recruitment Watcher (AI screening)...
start "CV Watcher" cmd /k "cd /d %ROOT%\LMS-Backend\AI && call %VENV%\Scripts\activate.bat && python cv_watcher.py"

:: -- Face Recognition Backend (FastAPI, port 8002) ------------
echo Starting Face Backend on port 8002...
start "Face Backend" cmd /k "cd /d %ROOT%\LMS-Face-Backend\face_rec && call %VENV%\Scripts\activate.bat && uvicorn api:app --host 0.0.0.0 --port 8002"

:: -- Next.js Frontend (port 3000) -----------------------------
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
echo  IMPORTANT: the web app's Reports page (/api/reports/*) has no FastAPI
echo  equivalent -- that route only exists in Node-LMS-Backend, which this
echo  launcher does not start.
echo.
echo  FastAPI:    http://localhost:8001 - mobile clients AND the web app's /api/*
echo  Face API:   http://localhost:8002
echo  Frontend:   http://localhost:3000
echo  CV Watcher: (no port) - AI CV screening, see the "CV Watcher" window
echo.
pause
