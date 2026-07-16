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

    class Config:
        env_file = str(_ENV_FILE)
        # Ignore unrelated environment variables. The CV pipeline (AI/config.py)
        # loads AI/.env into os.environ (GEMINI_API_KEY, CV_MODEL); without this
        # the watcher process — which imports both — would fail here on "extra
        # inputs are not permitted" when building these DB settings.
        extra = "ignore"


settings = Settings()