# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

backend_dir = Path(sys._getframe().f_code.co_filename).parent.resolve()
project_dir = backend_dir.parent

# ── Collect all submodules for complex packages ───────────────────────────
# Manual hiddenimports lists miss dynamically-imported submodules (e.g.
# pandas._config.localization, openpyxl submodules, docx oxml parts).
# collect_submodules walks the installed package and returns every importable
# submodule, preventing ModuleNotFoundError at runtime in the frozen build.
_hidden = [
    'backend.core.converter',
    'backend.core.database',
    'backend.core.renamer',
    'backend.core.config_fields',
    'backend.core.config_theme',
    'backend.core.plugins',
    'backend.core.history',
    'backend.core.format_registry',
    'backend.core.formatos',
    'backend.core.technical_reports',
    'backend.core.technical_reports.models',
    'backend.core.technical_reports.database',
    'backend.core.technical_reports.importer',
    'backend.core.technical_reports.rendering',
    'backend.core.informes_v2',
    'backend.core.informes_v2.models',
    'backend.core.informes_v2.database',
    'backend.core.informes_v2.importer',
    'backend.core.informes_v2.rendering',
    'backend.core.informes_v2.template_xlsx',
    'backend.core.fichas_tecnicas',
    'backend.core.fichas_tecnicas.models',
    'backend.core.fichas_tecnicas.database',
    'backend.core.fichas_tecnicas.importer',
    'backend.core.fichas_tecnicas.rendering',
    'backend.core.canvas',
    'backend.core.canvas.store',
    'backend.core.canvas.models',
    'backend.utils.validators',
    'backend.utils.paths',
    'backend.ipc_protocol',
    'backend.handlers',
    'backend.handlers.common',
    # CRITICAL: handlers load via importlib (lazy registry). PyInstaller cannot
    # see those dynamic imports — without these hiddenimports the frozen exe
    # starts (ready) but every IPC method fails with ModuleNotFoundError
    # (templates_list, canvas_*, etc.). At v0.10.20 these were static imports.
    'backend.handlers.info',
    'backend.handlers.theme',
    'backend.handlers.history',
    'backend.handlers.database',
    'backend.handlers.templates',
    'backend.handlers.canvas',
    'backend.handlers.conversion',
    'backend.handlers.formatos',
    'backend.handlers.optimizer',
    'backend.handlers.sellador',
    'backend.handlers.technical_reports',
    'backend.handlers.informes_v2',
    'backend.handlers.fichas_tecnicas',
    'backend.handlers.panel_aviso_corte',
    'backend.handlers.ubicaciones',
    'backend.handlers.evidencia_volanteo',
    'backend.handlers.spreadsheet',
    'backend.version',
]
# Collect every backend.handlers submodule as a safety net for future features.
_hidden += collect_submodules('backend.handlers')
_hidden += collect_submodules('backend.core')

# Collect ALL submodules from heavy third-party deps so PyInstaller does not
# miss dynamically-loaded ones (pandas._config.localization caused a startup
# crash in v0.10.10/v0.10.11 — see CHANGELOG).
# Skip *.tests / *.testing — collect_submodules walks them and burns minutes
# analyzing pandas.tests.* that never ship at runtime.
def _runtime_submodules(pkg: str) -> list[str]:
    return [
        m
        for m in collect_submodules(pkg)
        if '.tests' not in m and '.testing' not in m and not m.endswith('.conftest')
    ]


for _pkg in ('pandas', 'openpyxl', 'weasyprint', 'PIL', 'lxml', 'pypdf',
             'jinja2', 'jsonschema', 'docx', 'fitz', 'pymupdf'):
    _hidden += _runtime_submodules(_pkg)

# psutil has optional platform-specific binary extensions; collect them too.
try:
    _hidden += _runtime_submodules('psutil')
except Exception:
    _hidden.append('psutil')

# WeasyPrint uses urllib.request.HTTPSHandler and ssl at runtime for URL
# fetching (CSS url(), remote images). PyInstaller misses these on Windows
# because they are conditionally imported via C extensions. Add them
# explicitly so PDF generation does not crash with
# "module 'urllib.request' has no attribute 'HTTPSHandler'".
# ssl must be collected with its binaries (_ssl.pyd, libssl, libcrypto) —
# collect_submodules alone is not enough because PyInstaller may strip the
# native crypto DLLs, causing `import ssl` to silently fail, which makes
# urllib.request set _have_ssl=False and skip HTTPSHandler definition.
_hidden += [
    'ssl',
    'urllib.request',
    'urllib.error',
    'urllib.parse',
    'http.client',
    'http.server',
    'email.mime.text',
    'email.mime.multipart',
    'ctypes',
    'ctypes.wintypes',
]

# Collect ssl native binaries (_ssl.pyd and its dependencies) explicitly.
# strip=True on these DLLs can corrupt them on some toolchains, so we add
# them to upx_exclude as well.
_ssl_binaries = []
_ssl_dir = Path(sys.base_prefix) / 'DLLs'
for _name in ('_ssl.pyd', '_hashlib.pyd', 'libssl-3.dll', 'libcrypto-3.dll',
              'libssl-1_1.dll', 'libcrypto-1_1.dll'):
    _candidate = _ssl_dir / _name
    if _candidate.exists():
        _ssl_binaries.append((str(_candidate), '.'))

# Collect data files (templates, fonts, CSS) bundled inside packages.
_datas = [
    (str(backend_dir / 'templates'), 'backend/templates'),
    (str(backend_dir / 'core' / 'presets.json'), 'backend/core'),
    (str(project_dir / 'assets' / 'ubicaciones'), 'assets/ubicaciones'),
]
# weasyprint ships CSS default stylesheets and font config that must be present.
_datas += collect_data_files('weasyprint')

a = Analysis(
    [str(backend_dir / 'main.py')],
    pathex=[str(backend_dir), str(project_dir)],
    binaries=_ssl_binaries,
    datas=_datas,
    hiddenimports=_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
excludes=[
        # Optional acceleration/analytics stacks pulled in by pandas hooks.
        # The app uses pandas/openpyxl for Excel I/O, not SciPy/Numba.
        'scipy',
        'numba',
        'llvmlite',
        'numpy.testing',
        'numpy.distutils',
        'numpy.f2py',
        'pandas.tests',
        'pandas.testing',
        'pandas.plotting',
        'pandas.io.clipboard',
        'pandas.io.feather',
        'pandas.io.orc',
        'pandas.io.sas',
        'pandas.io.spss',
        'pandas.io.stata',
        'pandas.io.html',
        'pandas.io.xml',
        'pandas.io.excel._pyxlsb',
        'pandas.io.excel._odf',
        'pandas.io.excel._calamine',
        # Unused large modules and tooling
        'matplotlib',
        'notebook',
        'IPython',
        'jupyterlab',
        'tornado',
        'sqlalchemy',
        'pydoc',
        'doctest',
        'unittest',
        'pdb',
        'pytest',
        'pygments',
        'py',
        'pydantic',
        'rich',
        'anyio',
        'dns',
        'lxml.objectify',
        'pip',
        'tkinter',
        'test',
        'tests',
        'playwright',
        # ML / vision stacks often present in the builder's site-packages.
        # If PyInstaller pulls them in, the onedir tree exceeds size budgets and
        # cold-start AV scans drag past the IPC handshake window. Antares does
        # not import these — exclude unconditionally.
        'torch',
        'torchvision',
        'torchaudio',
        'tensorflow',
        'tensorboard',
        'keras',
        'cv2',
        'sklearn',
        'scikit-learn',
        'sympy',
        'transformers',
        'onnx',
        'onnxruntime',
        'jax',
        'jaxlib',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    # Loose .pyc next to the onedir tree — faster cold start than extracting a
    # onefile archive into %TEMP% on every launch (AV + handshake cliffs).
    noarchive=True,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Onedir (COLLECT): AntaresBackend.exe + deps live on disk under resources/backend.
# Avoids PyInstaller onefile re-extract + Windows AV on every cold start.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='AntaresBackend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[
        '_ssl.pyd',
        '_hashlib.pyd',
        'libssl-3.dll',
        'libcrypto-3.dll',
        'libssl-1_1.dll',
        'libcrypto-1_1.dll',
    ],
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    name='AntaresBackend',
)
