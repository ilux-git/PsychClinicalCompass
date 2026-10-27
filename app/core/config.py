from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, model_validator
from urllib.parse import urlsplit
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    compass_database_url: str
    mis_database_url: str
    redis_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60
    data_mode: Literal["synthetic_demo"] = "synthetic_demo"
    auth_login_max_attempts: int = Field(default=10, ge=1, le=100)
    auth_login_window_seconds: int = Field(default=300, ge=1, le=3600)
    telegram_bot_token: str = Field(default="", repr=False)
    telegram_webhook_secret: str = ""
    telegram_enabled: bool = False
    telegram_mini_app_enabled: bool = False
    telegram_init_data_max_age_seconds: int = Field(default=300, ge=60, le=3600)
    outbox_poll_interval_seconds: float = Field(default=5, gt=0, le=300)
    outbox_max_attempts: int = 5
    admin_analytics_min_group_size: int | None = Field(default=None, ge=1)
    load_test_mode: bool = False
    load_test_run_id: str = ""
    compass_db_pool_size: int = Field(default=5, ge=1, le=100)
    compass_db_max_overflow: int = Field(default=10, ge=0, le=100)
    read_audit_db_pool_size: int = Field(default=1, ge=1, le=10)
    mis_db_pool_size: int = Field(default=5, ge=1, le=100)
    mis_db_max_overflow: int = Field(default=10, ge=0, le=100)

    @model_validator(mode="after")
    def isolated_load_environment(self):
        if self.load_test_mode:
            if any(not urlsplit(url).path.endswith("_load_test") for url in (self.compass_database_url, self.mis_database_url)):
                raise ValueError("Load-test mode requires separate *_load_test databases")
            if self.telegram_enabled or self.telegram_mini_app_enabled or len(self.load_test_run_id) < 16:
                raise ValueError("Load-test mode requires a run marker and disabled external delivery")
        if self.telegram_mini_app_enabled and not self.telegram_bot_token.strip():
            raise ValueError("Telegram Mini App requires a configured bot credential")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


__all__ = ["Settings", "get_settings"]
