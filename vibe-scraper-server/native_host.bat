@echo off
:: Windows shim for the Vibe Scraper native messaging host.
:: Chrome requires a .bat (or .exe) as the host path on Windows.
:: This simply delegates to native_host.py using the same Python that ran install.py.
python "%~dp0native_host.py" %*
