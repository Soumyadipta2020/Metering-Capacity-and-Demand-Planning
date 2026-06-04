"""Build the local SQLite cache from data/inputs CSV files."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.sqlite_store import DB_PATH, build_sqlite_store, status  # noqa: E402


def main() -> int:
    ok = build_sqlite_store(force=True)
    info = status()
    if ok:
        print(f"SQLite store ready: {DB_PATH} ({info.get('size_bytes', 0):,} bytes)")
        for filename, count in sorted(info.get("row_counts", {}).items()):
            print(f"  {filename}: {count:,} rows")
        return 0
    print("SQLite store build failed; CSV fallback remains available.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
