from __future__ import annotations

import argparse
import gc
import os
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _rss_mb() -> float:
    import psutil

    return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def _boot(warm_deferred: bool) -> None:
    root = _repo_root()
    sys.path.insert(0, str(root))

    from backend.bootstrap import adjust_backend_import_path

    backend_dir = root / "backend"
    sys.path = adjust_backend_import_path(sys.path, backend_dir, frozen=False)

    from backend.core.database import get_db_path, init_db
    from backend.core.repository import close_connection, get_connection
    from backend.handlers import HANDLERS

    init_db()
    HANDLERS.warm_core()

    if warm_deferred:
        HANDLERS.warm_deferred()
    else:
        for method in ("version", "formats", "preview", "canvas_get", "db_get_fields"):
            HANDLERS.get(method)

    get_connection(get_db_path())
    gc.collect()
    close_connection()


def _isolate_user_data() -> Path:
    import tempfile

    root = Path(tempfile.mkdtemp(prefix="antares-rss-"))
    os.environ["LOCALAPPDATA"] = str(root)
    os.environ["XDG_DATA_HOME"] = str(root / "xdg")
    return root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--warm-deferred",
        action="store_true",
        help="Eagerly warm deferred handler modules (legacy high-RSS path).",
    )
    parser.add_argument(
        "--profile-lines",
        action="store_true",
        help="Optionally wrap boot with memory_profiler (if installed).",
    )
    parser.add_argument(
        "--use-real-user-data",
        action="store_true",
        help="Do not isolate LOCALAPPDATA (default: fresh temp catalog).",
    )
    args = parser.parse_args()

    if not args.use_real_user_data:
        data_root = _isolate_user_data()
        print(f"USER_DATA_ISOLATED={data_root}", flush=True)

    env_warm = os.environ.get("ANTARES_WARM_DEFERRED", "").strip().lower() in {"1", "true", "yes"}
    warm_deferred = bool(args.warm_deferred or env_warm)

    before = _rss_mb()
    print(f"RSS_MB_BEFORE_BOOT={before:.2f}", flush=True)

    if args.profile_lines:
        try:
            from memory_profiler import memory_usage
        except ImportError:
            print("memory_profiler not installed; continuing without line profile", file=sys.stderr)
            _boot(warm_deferred)
        else:
            mem = memory_usage((_boot, (warm_deferred,), {}), interval=0.1, max_usage=True)
            print(f"MEMORY_PROFILER_MAX_MB={float(mem):.2f}", flush=True)
    else:
        _boot(warm_deferred)

    after = _rss_mb()
    print(f"warm_deferred={warm_deferred}", flush=True)
    print(f"RSS_MB={after:.2f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
