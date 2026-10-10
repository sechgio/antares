"""Audit all locked runtime dependencies without resolving the project again."""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="antares-audit-") as directory:
        requirements = str(Path(directory) / "requirements.txt")
        exported = subprocess.run(
            [
                "uv", "export", "--locked", "--no-dev", "--no-emit-project",
                "--format", "requirements-txt", "--output-file", requirements,
            ],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            check=False,
        )
        if exported.returncode:
            return exported.returncode
        return subprocess.run(
            [sys.executable, "-m", "pip_audit", "--require-hashes", "--disable-pip", "-r", requirements],
            cwd=ROOT,
            check=False,
        ).returncode


if __name__ == "__main__":
    sys.exit(main())
