from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    internal_api_key: str = ""
    index_dir: str = "./data/indexes"
    chunk_size: int = 800
    chunk_overlap: int = 150
    top_k: int = 5
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_embed_model: str = "text-embedding-3-small"

    @property
    def demo(self) -> bool:
        return not self.openai_api_key


settings = Settings()