"""App version router — /app/* endpoints for the mobile update flow."""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from repositories.app_version_repository import evaluate_app_version

router = APIRouter(prefix="/app", tags=["App Version"])

# Directory the latest release APK is dropped into (as app-latest.apk).
APK_DIR = os.environ.get(
    "APK_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "apk"),
)
APK_LATEST_NAME = os.environ.get("APK_LATEST_NAME", "app-latest.apk")


@router.get("/version-check")
def version_check(
    platform: str = Query("ANDROID", description="ANDROID / IOS"),
    version: Optional[str] = Query(None, description="App version, e.g. 1.4.2"),
    build: Optional[int] = Query(None, description="App build number, e.g. 48"),
):
    """Called by the app on launch and after login. Returns whether the client is
    up to date, needs a soft (optional) update, or a force (mandatory) one."""
    return evaluate_app_version(version=version, build=build, platform=platform)


@router.get("/download/latest")
def download_latest_apk():
    """Serve the latest release APK. Point APP_VERSION.UPDATE_URL at this URL."""
    path = os.path.join(APK_DIR, APK_LATEST_NAME)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No APK is currently published")
    return FileResponse(
        path,
        media_type="application/vnd.android.package-archive",
        filename=APK_LATEST_NAME,
    )
