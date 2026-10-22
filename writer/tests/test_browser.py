"""Run the shared browser suite against the integrated application."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
subprocess.run(["node", str(ROOT / "tools/md2pdf/test-browser.cjs")], cwd=ROOT, check=True)
