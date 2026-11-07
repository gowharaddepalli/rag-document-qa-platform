# RAG Document Q&A Platform

A document question-answering application that combines a React frontend, an Express/TypeScript API, and a Python retrieval-augmented generation service.

## Features
- User registration and authentication API.
- Document upload workflow with PDF processing.
- Text extraction, chunking, embeddings, and vector retrieval.
- Question answering with source/citation-oriented responses.
- Docker Compose configuration for local service orchestration.
- Frontend, API, and RAG-service test suites.

## Tech stack
React, TypeScript, Express, MongoDB/Mongoose, Python, FastAPI, LangChain, FAISS, PDF parsing, JWT.

## Project structure
- `src/` — frontend routes, chat, dashboard, and citation UI.
- `server/` — Express API, authentication, document/chat routes, and RAG client.
- `rag-service/` — PDF extraction, chunking, embeddings, vector store, and answer generation.
- `docker-compose.yml` — local multi-service setup.

## Getting started
1. Copy the root `.env.example`, `server/.env.example`, and `rag-service/.env.example` as needed and configure local values.
2. Start the services with Docker Compose:
```bash
docker compose up --build
```
3. Review the service-specific Dockerfiles and environment examples when running components individually.

## Tests
Frontend (from repository root):
```bash
bun install
bunx vitest run
```

Express API:
```bash
cd server
bun install
bun run build
bun run test
```

Python RAG service:
```bash
cd rag-service
python -m venv .venv
# Activate the virtual environment, then:
pip install -r requirements.txt
pytest
```

## Security and configuration
Use strong, unique JWT secrets and database credentials. Keep API keys and real environment files out of version control. Review upload limits and deployment settings before exposing the service publicly. The no-key/demo behavior and supported model configuration are defined in the service code and environment example.

## License
MIT. See [LICENSE](LICENSE).
