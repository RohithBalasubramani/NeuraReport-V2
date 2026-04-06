"""repositories package — wraps the original flat module (now repositories_base.py).

This package exists so that `backend.app.repositories.dataframes.sqlite_loader`
is importable while keeping all original `from backend.app.repositories import X`
working unchanged.
"""
import importlib as _importlib
import sys as _sys

# Import the base module
_base = _importlib.import_module("backend.app.repositories_base")

# Re-export every public attribute from the base module into this package
_this = _sys.modules[__name__]
for _name in dir(_base):
    if not _name.startswith("__"):
        setattr(_this, _name, getattr(_base, _name))

# Also copy __all__ if present (merge all of them)
if hasattr(_base, "__all__"):
    __all__ = list(_base.__all__)
