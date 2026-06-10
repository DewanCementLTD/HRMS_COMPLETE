@echo off
:: Navigate to the folder containing your main.py
cd /d "C:\Erp_Systems\HRMS_LMS_APP\attendance_app(LMS)\LMS-Backend\face_rec"

:: Activate the specific virtual environment
call "C:\Erp_Systems\HRMS_LMS_APP\attendance_app(LMS)\LMS-Backend\face_rec\venv310\Scripts\activate.bat"

:: Run the FastAPI server with your specific settings
uvicorn api:app --host 0.0.0.0 --port 8002 --reload

pause
