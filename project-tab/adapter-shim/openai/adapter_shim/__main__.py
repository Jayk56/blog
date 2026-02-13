"""Entry point: python -m adapter_shim --port 9100 [--mock]"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys

import uvicorn

from .app import create_app


def find_free_port() -> int:
    """Bind to port 0 to let the OS assign a free port, then release it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI Adapter Shim")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AGENT_PORT", "9100")), help="Port to listen on (also reads AGENT_PORT env var)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--mock", action="store_true", help="Run in mock mode (scripted events, no OpenAI API key needed)")
    parser.add_argument("--workspace", type=str, default=None, help="Working directory for the Codex CLI (passed as --cd)")
    args = parser.parse_args()

    if args.port == 0:
        args.port = find_free_port()

    app = create_app(mock=args.mock, workspace=args.workspace)

    # Announce port on stdout for parent process discovery
    print(json.dumps({"port": args.port}), flush=True)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
