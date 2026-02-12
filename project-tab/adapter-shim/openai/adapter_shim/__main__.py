"""Entry point: python -m adapter_shim --port 9100 [--mock]"""

from __future__ import annotations

import argparse
import os
import sys

import uvicorn

from .app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI Adapter Shim")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AGENT_PORT", "9100")), help="Port to listen on (also reads AGENT_PORT env var)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--mock", action="store_true", help="Run in mock mode (scripted events, no OpenAI API key needed)")
    args = parser.parse_args()

    app = create_app(mock=args.mock)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
