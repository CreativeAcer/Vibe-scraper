#!/usr/bin/env python3
"""
Vibe Scraper — Chrome Native Messaging Host

Chrome launches this script when the extension calls
chrome.runtime.sendNativeMessage('com.vibescaper.server', ...).

Protocol: each message is a 4-byte little-endian length followed by UTF-8 JSON,
on stdin (incoming) and stdout (outgoing). stderr is safe for debug logging.

Commands received from the extension:
  {"command": "start"}  — start server.py if not already running
  {"command": "status"} — report whether the server is reachable

Response:
  {"running": true}
  {"running": false, "error": "..."}
"""

import json
import os
import struct
import subprocess
import sys
import urllib.request

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
HEALTH_URL = "http://localhost:7823/health"


def read_message() -> dict | None:
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack("<I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def write_message(msg: dict) -> None:
    data = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def is_server_running() -> bool:
    try:
        urllib.request.urlopen(HEALTH_URL, timeout=1)
        return True
    except Exception:
        return False


def start_server() -> None:
    """Spawn server.py as a detached process that outlives this host."""
    server_script = os.path.join(SERVER_DIR, "server.py")
    cmd = [sys.executable, server_script]

    if sys.platform == "win32":
        subprocess.Popen(
            cmd,
            cwd=SERVER_DIR,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    else:
        subprocess.Popen(
            cmd,
            cwd=SERVER_DIR,
            start_new_session=True,
            close_fds=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    message = read_message()
    if message is None:
        write_message({"running": False, "error": "No message received"})
        return

    command = message.get("command", "status")

    if command == "status":
        write_message({"running": is_server_running()})
        return

    if command == "start":
        if is_server_running():
            write_message({"running": True})
            return
        try:
            start_server()
            write_message({"running": True})
        except Exception as exc:
            write_message({"running": False, "error": str(exc)})
        return

    write_message({"running": False, "error": f"Unknown command: {command}"})


if __name__ == "__main__":
    main()
