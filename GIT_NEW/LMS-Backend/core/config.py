from pathlib import Path

from pydantic_settings import BaseSettings

# Absolute path to the backend's .env (this file lives in LMS-Backend/core/, so
# the backend root is one level up). Using an absolute path makes the DB settings
# load regardless of the process's working directory — the CV watcher runs from
# AI/, where a relative ".env" would resolve to AI/.env and miss the DB creds.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    DB_USER: str
    DB_PASSWORD: str
    DB_DSN: str

    # Base URL of the face-recognition service (api:app on port 8002). Used by the
    # attendance endpoint to re-verify a submitted face against the card being
    # marked. Defaults to localhost so no .env change is required; override in .env
    # if the face service moves to another host/port.
    FACE_SERVICE_URL: str = "http://127.0.0.1:8002"

    # HMAC signing key for the session tokens issued at /auth/login and
    # checked by POST /auth/location/batch (core/tokens.py). Set a long random
    # value in .env before turning LOCATION_BATCH_ENFORCE_TOKEN on — tokens
    # signed with the empty-string fallback are forgeable by anyone who can
    # read this source.
    JWT_SECRET_KEY: str = ""

    # Phase 2 of the 2026-09-22 location-batch auth rollout: while False,
    # missing/invalid tokens on POST /auth/location/batch are only logged
    # (older app builds may not send one yet). Flip to True in .env — no code
    # change or redeploy needed — once the token-sending app build has had a
    # few days to roll out, to start rejecting with 401.
    LOCATION_BATCH_ENFORCE_TOKEN: bool = False

    class Config:
        env_file = str(_ENV_FILE)
        # Ignore unrelated environment variables. The CV pipeline (AI/config.py)
        # loads AI/.env into os.environ (GEMINI_API_KEY, CV_MODEL); without this
        # the watcher process — which imports both — would fail here on "extra
        # inputs are not permitted" when building these DB settings.
        extra = "ignore"


settings = Settings()