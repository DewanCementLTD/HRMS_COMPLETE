"""Production launcher for the LMS backend on port 8001.

Why this exists (instead of plain `uvicorn main:app`):
On Windows, uvicorn hard-codes asyncio's ProactorEventLoop. The Proactor loop
has a known fatal quirk: when a client drops the TCP connection mid-accept
(flaky mobile networks do this constantly), accept() raises
OSError [WinError 64] and asyncio CLOSES THE LISTENING SOCKET. The process
stays alive but the port stops accepting — the backend silently dies until
someone restarts it.

The SelectorEventLoop does not close the listener on a failed accept, so we
run uvicorn's Server on an explicit SelectorEventLoop instead.

Run:  .venv\\Scripts\\python.exe serve.py      (or via run_8001.bat)
Note: no --reload here — restart the process to load code changes.
"""
import asyncio
import sys

from uvicorn import Config, Server


def main() -> None:
    config = Config(
        "main:app",
        host="0.0.0.0",     # reachable from phones on the network
        port=8001,
        log_level="info",
    )
    server = Server(config)

    if sys.platform == "win32":
        loop = asyncio.SelectorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
