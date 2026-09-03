import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

backend_dir = Path(sys._getframe().f_code.co_filename).parent.resolve()
project_dir = backend_dir.parent

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
    'backend.handlers.info',
    'backend.handlers.diagnostics',
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
    'backend.handlers.telemetry',
    'backend.version',
]
_hidden += collect_submodules('backend.handlers')
_hidden += collect_submodules('backend.core')

def _runtime_submodules(pkg: str) -> list[str]:
    return [
        m
        for m in collect_submodules(pkg)
        if '.tests' not in m and '.testing' not in m and not m.endswith('.conftest')
    ]


for _pkg in ('pandas', 'openpyxl', 'weasyprint', 'PIL', 'lxml', 'pypdf',
             'jinja2', 'jsonschema', 'docx', 'fitz', 'pymupdf'):
    _hidden += _runtime_submodules(_pkg)

try:
    _hidden += _runtime_submodules('psutil')
except Exception:
    _hidden.append('psutil')

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

_ssl_binaries = []
_ssl_dir = Path(sys.base_prefix) / 'DLLs'
for _name in ('_ssl.pyd', '_hashlib.pyd', 'libssl-3.dll', 'libcrypto-3.dll',
              'libssl-1_1.dll', 'libcrypto-1_1.dll'):
    _candidate = _ssl_dir / _name
    if _candidate.exists():
        _ssl_binaries.append((str(_candidate), '.'))

_datas = [
    (str(backend_dir / 'templates'), 'backend/templates'),
    (str(backend_dir / 'core' / 'presets.json'), 'backend/core'),
    (str(project_dir / 'assets' / 'ubicaciones'), 'assets/ubicaciones'),
    (str(project_dir / 'shared' / 'default-theme.json'), 'shared'),
]
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
    noarchive=True,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

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
