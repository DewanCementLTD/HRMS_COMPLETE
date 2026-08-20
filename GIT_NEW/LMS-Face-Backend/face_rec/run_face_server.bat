@echo off
:: Standalone launcher for the face service — start_all.bat starts this same
:: server itself, so use this only when running face recognition on its own.

:: Run from this script's own folder (api.py imports sibling modules by bare
:: name). %~dp0 keeps this working after a move; the old hard-coded
:: C:\Erp_Systems\HRMS_LMS_APP\attendance_app(LMS)\... does not exist here.
cd /d "%~dp0"

:: Shared backend venv — insightface/onnxruntime are installed there. The old
:: face_rec\venv310 is not part of this deployment.
call "%~dp0..\..\LMS-Backend\.venv\Scripts\activate.bat"

:: Run the FastAPI server with your specific settings
uvicorn api:app --host 0.0.0.0 --port 8002 --reload

pause
