@echo off
echo ============================================================
echo  LMS Server Launcher
echo ============================================================
echo.

:: -- Step 1: Kill the backend auto-restart loop FIRST ---------
:: run_8001.bat is a watchdog: it relaunches serve.py 3 seconds after it
:: exits, forever. If we only killed the process LISTENING on 8001, this
:: loop would respawn serve.py while we start a fresh backend and the port
:: bind would fail with WinError 10048. Kill the loop (cmd running
:: run_8001.bat) and any serve.py python BEFORE freeing the ports.

echo [1/5] Stopping backend auto-restart loop (run_8001.bat / serve.py)...
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%run_8001%%' and not CommandLine like '%%wmic%%'" get ProcessId ^| findstr /r "[0-9]"') do (
    echo     Killing restart-loop PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%serve.py%%' and not CommandLine like '%%wmic%%'" get ProcessId ^| findstr /r "[0-9]"') do (
    echo     Killing serve.py PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 2: Kill anything holding ports 3000, 8001, 8002 -----

echo [2/5] Stopping existing processes on ports 3000, 8001, 8002, 8003...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 3000
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8003 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8003
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

:: -- Step 3: Kill the PM2 daemon so it stops auto-restarting --

echo [3/5] Stopping PM2 daemon...
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%pm2%%Daemon%%'" get ProcessId ^| findstr /r "[0-9]"') do (
    echo     Killing PM2 daemon PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 4: Kill any running CV watcher so we don't run two ---
:: The watcher has no port; two copies would both grab CV_Buffer files and
:: double-process them. Kill the old one before starting a fresh window.

echo [4/5] Stopping existing CV watcher (if any)...
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%cv_watcher.py%%'" get ProcessId ^| findstr /r "[0-9]"') do (
    echo     Killing CV watcher PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 5: Wait for ports to fully release -------------------

echo [5/5] Waiting 4 seconds for ports to clear...
timeout /t 4 /nobreak >nul

echo.
echo ============================================================
echo  Starting servers...
echo ============================================================
echo.

:: -- LMS Backend (FastAPI, port 8001) -------------------------
:: Started via run_8001.bat, NOT plain uvicorn:
::  - serve.py runs uvicorn on a SelectorEventLoop, fixing the Windows bug
::    where a dropped connection (WinError 64) silently closes the listening
::    socket and the port dies until someone restarts the process.
::  - the bat loop auto-restarts the server if it ever crashes.
:: Step 1 above kills any previous copy of this loop, so re-running this
:: launcher never fights itself for port 8001.
:: NOTE: full path + call is required — on this server cmd does not resolve a
:: bare "run_8001.bat" from the current directory ("not recognized").
echo Starting LMS Backend on port 8001...
start "LMS Backend" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend && call C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend\run_8001.bat"

:: -- Node LMS Backend (Express, port 8003) --------------------
:: This is the backend the web app actually talks to now: LMS-Web's
:: next.config.ts rewrites send /api/* here. The FastAPI server above stays up
:: because it still serves /payroll* and /payroll-entry* (46 endpoints not yet
:: ported) — see the two payroll rewrite rules in next.config.ts.
echo Starting Node LMS Backend on port 8003...
start "Node Backend" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\Node-LMS-Backend && npm start"

:: -- CV Recruitment Watcher (AI pipeline, no port) ------------
:: Watches AI\Recruitment\<company>\CV_Buffer\<job>\ for dropped CV PDFs,
:: extracts + LLM-evaluates each one and persists it to the recruitment DB
:: (candidate -> application -> evaluation). Uses the SAME .venv as the backend.
:: Runs from the AI folder because the pipeline modules import each other by
:: bare name (config, cv_extractor, ...). Leave this window open while HR uploads CVs.
echo Starting CV Recruitment Watcher (AI screening)...
start "CV Watcher" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend\AI && call C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend\.venv\Scripts\activate.bat && python cv_watcher.py"

:: -- Face Recognition Backend (FastAPI, port 8002) ------------
echo Starting Face Backend on port 8002...
start "Face Backend" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Face-Backend\face_rec && call C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend\.venv\Scripts\activate.bat && uvicorn api:app --host 0.0.0.0 --port 8002"

:: -- Next.js Frontend (port 3000) -----------------------------
:: IMPORTANT: build BEFORE start so the served .next is always fresh and
:: consistent. "&&" means npm run start only runs if the build succeeds -- if the
:: build fails, this window stays open showing the error instead of serving a
:: stale/broken build (which is what causes ChunkLoadError in the browser).
echo Starting Frontend on port 3000 (building first, please wait)...
start "LMS Frontend" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Web && echo ===== Building frontend (npm run build) ===== && npm run build && echo ===== Build OK - starting (npm run start) ===== && npm run start"

echo.
echo All servers started in separate windows.
echo.
echo  NOTE: the Frontend window builds first (~15-30s) before it serves.
echo  Wait for "Build OK - starting" in that window before opening the app,
echo  then hard-refresh the browser (Ctrl+Shift+R) to drop any cached chunks.
echo.
echo  Node API:   http://localhost:8003 - serves the web app (all but payroll)
echo  FastAPI:    http://localhost:8001 - payroll + mobile clients
echo  Face API:   http://localhost:8002
echo  Frontend:   http://localhost:3000
echo  CV Watcher: (no port) - AI CV screening, see the "CV Watcher" window
echo.
pause
