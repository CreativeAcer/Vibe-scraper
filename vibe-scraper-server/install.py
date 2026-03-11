#!/usr/bin/env python3
"""
Vibe Scraper — cross-platform installer.

What this does:
  1. Installs Python dependencies (pip install -r requirements.txt)
  2. Installs Playwright's Chromium browser (for JS-heavy sites)
  3. Finds the Vibe Scraper extension ID in your Chrome/Edge/Brave profile
  4. Registers the native messaging host so Chrome can auto-start the server

Run once, then restart Chrome. After that the extension starts the server
automatically — no terminal needed.

Usage:
  python install.py            (detects extension ID automatically)
  python install.py --id <ID>  (specify extension ID manually)
"""

import argparse
import glob
import json
import os
import platform
import shutil
import stat
import subprocess
import sys


# ── Config ────────────────────────────────────────────────────────────────────

NATIVE_HOST_NAME = "com.vibescaper.server"
SERVER_DIR        = os.path.dirname(os.path.abspath(__file__))
HOST_SCRIPT       = os.path.join(SERVER_DIR, "native_host.py")
HOST_BAT          = os.path.join(SERVER_DIR, "native_host.bat")
MANIFEST_FILENAME = f"{NATIVE_HOST_NAME}.json"

# Chrome/Chromium user data base directories per OS
CHROME_DIRS = {
    "windows": [
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data"),
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"),
    ],
    "mac": [
        os.path.expanduser("~/Library/Application Support/Google/Chrome"),
        os.path.expanduser("~/Library/Application Support/Microsoft Edge"),
        os.path.expanduser("~/Library/Application Support/BraveSoftware/Brave-Browser"),
    ],
    "linux": [
        os.path.expanduser("~/.config/google-chrome"),
        os.path.expanduser("~/.config/chromium"),
        os.path.expanduser("~/.config/microsoft-edge"),
        os.path.expanduser("~/.config/BraveSoftware/Brave-Browser"),
    ],
}

# Where Chrome reads native messaging manifests per OS
NATIVE_MESSAGING_DIRS = {
    "windows": None,  # Windows uses the registry instead
    "mac": [
        os.path.expanduser("~/Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        os.path.expanduser("~/Library/Application Support/Microsoft Edge/NativeMessagingHosts"),
        os.path.expanduser("~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ],
    "linux": [
        os.path.expanduser("~/.config/google-chrome/NativeMessagingHosts"),
        os.path.expanduser("~/.config/chromium/NativeMessagingHosts"),
        os.path.expanduser("~/.config/microsoft-edge/NativeMessagingHosts"),
        os.path.expanduser("~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ],
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_os() -> str:
    system = platform.system().lower()
    if system == "windows":  return "windows"
    if system == "darwin":   return "mac"
    return "linux"


def step(msg: str) -> None:
    print(f"\n▶  {msg}")


def ok(msg: str) -> None:
    print(f"   ✅ {msg}")


def warn(msg: str) -> None:
    print(f"   ⚠️  {msg}")


def run(cmd: list, description: str) -> bool:
    print(f"   $ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        warn(f"{description} failed (exit {result.returncode})")
        return False
    return True


# ── Step 1 & 2: Install deps ──────────────────────────────────────────────────

def install_dependencies() -> None:
    step("Installing Python dependencies...")
    req = os.path.join(SERVER_DIR, "requirements.txt")
    run([sys.executable, "-m", "pip", "install", "-r", req, "-q"], "pip install")
    ok("Dependencies installed.")


def install_playwright() -> None:
    step("Installing Playwright browser (Chromium)...")
    print("   This downloads ~300 MB the first time. Please wait...")
    run([sys.executable, "-m", "playwright", "install", "chromium"], "playwright install")
    ok("Playwright Chromium installed.")


# ── Step 3: Find extension ID ─────────────────────────────────────────────────

def find_extension_id(os_name: str) -> str | None:
    """Scan Chrome's extensions directory for Vibe Scraper and return its ID."""
    for base_dir in CHROME_DIRS.get(os_name, []):
        if not os.path.isdir(base_dir):
            continue
        # Extensions live at <base>/Default/Extensions/<id>/<version>/manifest.json
        pattern = os.path.join(base_dir, "Default", "Extensions", "*", "*", "manifest.json")
        for manifest_path in glob.glob(pattern):
            try:
                with open(manifest_path, encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("name") == "Vibe Scraper":
                    # The extension ID is the grandparent directory name
                    ext_id = os.path.basename(os.path.dirname(os.path.dirname(manifest_path)))
                    return ext_id
            except Exception:
                continue
    return None


def prompt_for_extension_id() -> str:
    print()
    print("   Could not find Vibe Scraper in your Chrome profile automatically.")
    print("   To find your extension ID:")
    print("     1. Open Chrome and go to  chrome://extensions")
    print("     2. Enable 'Developer mode' (top-right toggle)")
    print("     3. Find 'Vibe Scraper' and copy the ID shown below its name")
    print()
    ext_id = input("   Paste extension ID here: ").strip()
    return ext_id


# ── Step 4: Write native host manifest ───────────────────────────────────────

def build_manifest(ext_id: str, os_name: str) -> dict:
    host_path = HOST_BAT if os_name == "windows" else HOST_SCRIPT
    return {
        "name": NATIVE_HOST_NAME,
        "description": "Vibe Scraper local server host",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{ext_id}/"],
    }


# ── Step 5: Register manifest ─────────────────────────────────────────────────

def register_windows(manifest: dict) -> None:
    import winreg  # type: ignore  (Windows only)

    # Write the manifest JSON to a file next to the scripts
    manifest_path = os.path.join(SERVER_DIR, MANIFEST_FILENAME)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Register the file path in the Windows registry
    reg_key = rf"Software\Google\Chrome\NativeMessagingHosts\{NATIVE_HOST_NAME}"
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_key, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_path)
        winreg.CloseKey(key)
        ok(f"Registry key written: HKCU\\{reg_key}")
    except Exception as exc:
        warn(f"Could not write registry key: {exc}")
        print(f"   Manual fix: set HKCU\\{reg_key} = \"{manifest_path}\"")

    # Also register for Edge and Brave if they exist
    for browser in ["Microsoft\\Edge", "BraveSoftware\\Brave-Browser"]:
        alt_key = rf"Software\{browser}\NativeMessagingHosts\{NATIVE_HOST_NAME}"
        try:
            key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, alt_key, 0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_path)
            winreg.CloseKey(key)
        except Exception:
            pass  # optional, ignore failures


def register_unix(manifest: dict, os_name: str) -> None:
    dirs = NATIVE_MESSAGING_DIRS.get(os_name, [])
    written = 0
    for target_dir in dirs:
        if not os.path.isdir(os.path.dirname(target_dir)):
            continue  # browser not installed
        os.makedirs(target_dir, exist_ok=True)
        manifest_path = os.path.join(target_dir, MANIFEST_FILENAME)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        ok(f"Manifest written: {manifest_path}")
        written += 1
    if written == 0:
        warn("No supported browser directories found. Is Chrome/Chromium installed?")


def make_executable() -> None:
    current = os.stat(HOST_SCRIPT).st_mode
    os.chmod(HOST_SCRIPT, current | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Vibe Scraper installer")
    parser.add_argument("--id", dest="ext_id", default=None,
                        help="Chrome extension ID (auto-detected if omitted)")
    parser.add_argument("--skip-deps", action="store_true",
                        help="Skip pip install and playwright install")
    args = parser.parse_args()

    print("=" * 55)
    print("  Vibe Scraper — Local Server Installer")
    print("=" * 55)

    os_name = get_os()
    print(f"\n  Platform detected: {platform.system()} ({os_name})")
    print(f"  Python: {sys.executable}")

    if not args.skip_deps:
        install_dependencies()
        install_playwright()

    # Find or prompt for extension ID
    step("Finding Vibe Scraper extension ID...")
    ext_id = args.ext_id or find_extension_id(os_name)
    if ext_id:
        ok(f"Extension ID: {ext_id}")
    else:
        ext_id = prompt_for_extension_id()
        if not ext_id:
            print("\n  ❌ Extension ID is required. Aborting.")
            sys.exit(1)

    # Build manifest
    manifest = build_manifest(ext_id, os_name)

    # Register
    step("Registering native messaging host with Chrome...")
    if os_name == "windows":
        register_windows(manifest)
    else:
        make_executable()
        register_unix(manifest, os_name)

    print()
    print("=" * 55)
    print("  ✅ Installation complete!")
    print()
    print("  Next steps:")
    print("  1. Restart Chrome (close all windows and reopen)")
    print("  2. Open the Vibe Scraper extension")
    print("  3. The server will start automatically — look for")
    print("     the green 'Local server connected' indicator.")
    print()
    print("  To uninstall, run:  python install.py --uninstall")
    print("=" * 55)


if __name__ == "__main__":
    main()
