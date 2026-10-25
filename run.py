"""Reika entry point, including support for the Windows embedded Python build."""

import sys
from pathlib import Path


if sys.version_info < (3, 10):
    print("Для Reika нужен Python 3.10 или новее.", file=sys.stderr)
    raise SystemExit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reika.app import main


if __name__ == "__main__":
    raise SystemExit(main())
