"""SpendSentinel engine (Python). Stdlib only, shared by the laptop API and the phone edge node."""
from .core import Params, Row, analyze, daily_totals, detect, explain, judge, parse_csv  # noqa: F401
