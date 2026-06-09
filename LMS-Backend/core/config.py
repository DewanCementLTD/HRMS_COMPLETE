from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DB_USER: str
    DB_PASSWORD: str
    DB_DSN: str

    class Config:
        env_file = ".env"


settings = Settings()