// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const python = path.join(repo, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const probe = `
import json, os, sys
from pathlib import Path
from unittest.mock import patch
from backend.core.agent import skills

options = json.loads(sys.stdin.read())
root = Path(options['root'])
os.chdir(root)
workspace, library = root / 'workspace', root / 'library'
workspace.mkdir(exist_ok=True)
library.mkdir(exist_ok=True)
scans, opened = [], []
original_iterdir, original_open = Path.iterdir, Path.open
def track_iterdir(folder):
    scans.append(str(folder))
    return original_iterdir(folder)
def track_open(file, *args, **kwargs):
    opened.append(str(file))
    return original_open(file, *args, **kwargs)
with patch.object(Path, 'iterdir', track_iterdir), patch.object(Path, 'open', track_open):
    catalog = skills.run('skills_list', {}, {}, workspace, library, agent_id=options.get('agent'))
contents = {}
for item in catalog['skills']:
    contents[item['name']] = skills.run('skills_read', {'skill_id': item['id']}, {}, workspace, library,
                                       agent_id=options.get('agent'))['content']
print(json.dumps({'catalog': catalog, 'contents': contents, 'scans': scans, 'opened': opened}))
`;

let root;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'antares-skills-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function install(relative, body = 'Instrucciones', header = true) {
  const folder = path.join(root, relative);
  mkdirSync(folder, { recursive: true });
  const name = path.basename(folder);
  const content = header ? `---\nname: ${name}\ndescription: Revisión ${name}\n---\n${body}` : body;
  const target = path.join(folder, 'SKILL.md');
  writeFileSync(target, content);
  return target;
}

function load(agent = 'reader', env = {}) {
  return JSON.parse(execFileSync(python, ['-c', probe], {
    cwd: repo,
    input: JSON.stringify({ root, agent }),
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: repo, PYTHONUTF8: '1', SKILLS_HOME: '', ORBS_SHARED_HOME: '', ...env },
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }));
}

it('prioriza la propia y nunca abre la compartida reemplazada', () => {
  const shared = install('skills/_shared/review', 'Compartida');
  const own = install('skills/reader/review', 'Propia');
  const result = load();
  expect(result.catalog.skills.map(skill => skill.location)).toEqual([own]);
  expect(result.contents.review).toContain('Propia');
  expect(result.opened).not.toContain(shared);
});

it('registra un único aviso con las dos rutas cuando hay colisión', () => {
  const shared = install('skills/_shared/review');
  const own = install('skills/reader/review');
  const { catalog } = load();
  expect(catalog.warnings).toHaveLength(1);
  expect(catalog.warnings[0]).toContain(shared);
  expect(catalog.warnings[0]).toContain(own);
  expect(catalog.warnings[0]).toContain('sustituye');
});

it('hace visible una skill solo compartida para cualquier agente y sin perfil', () => {
  const target = install('skills/_shared/review');
  for (const agent of ['reader', 'writer', null]) {
    const { catalog } = load(agent);
    expect(catalog.skills.map(skill => skill.location)).toEqual([target]);
    expect(catalog.warnings).toEqual([]);
  }
});

it('carga una skill solo propia y la oculta a otros agentes', () => {
  const target = install('skills/reader/review');
  expect(load().catalog.skills.map(skill => skill.location)).toEqual([target]);
  expect(load('writer').catalog.skills).toEqual([]);
});

it('aísla skills del mismo nombre con contenido distinto entre agentes sin avisar', () => {
  install('skills/reader/review', 'Lectura');
  install('skills/writer/review', 'Escritura');
  const reader = load();
  const writer = load('writer');
  expect(reader.contents.review).toContain('Lectura');
  expect(writer.contents.review).toContain('Escritura');
  expect(reader.catalog.warnings).toEqual([]);
  expect(writer.catalog.warnings).toEqual([]);
});

it('descarta SKILL.md sin frontmatter y sigue cargando las demás', () => {
  install('skills/_shared/broken', 'Sin encabezado', false);
  install('skills/_shared/valid');
  const { catalog } = load();
  expect(catalog.skills.map(skill => skill.name)).toEqual(['valid']);
  expect(catalog.warnings).toEqual([expect.stringMatching(/broken:.*frontmatter.*name.*description/)]);
});

it('exige name y description sin interrumpir el catálogo', () => {
  install('skills/_shared/no-name', '---\ndescription: Descripción\n---\nTexto', false);
  install('skills/reader/no-description', '---\nname: no-description\n---\nTexto', false);
  install('skills/_shared/valid');
  const { catalog } = load();
  expect(catalog.skills.map(skill => skill.name)).toEqual(['valid']);
  expect(catalog.warnings).toHaveLength(2);
});

it('respeta ambas variables y recorre cada nivel una sola vez por carga', () => {
  install('configured/reader/own');
  install('alternative/shared');
  install('configured/_shared/ignored');
  const shared = path.join(root, 'alternative');
  const own = path.join(root, 'configured/reader');
  const result = load('reader', { SKILLS_HOME: './configured', ORBS_SHARED_HOME: shared });
  expect(result.catalog.skills.map(skill => skill.name)).toEqual(['own', 'shared']);
  expect(result.scans.filter(folder => folder === own)).toHaveLength(1);
  expect(result.scans.filter(folder => folder === shared)).toHaveLength(1);
});

it('lee instrucciones sin ejecutar scripts ni interpretar allowed-tools como permisos', () => {
  const target = install('skills/_shared/review', '---\nname: review\ndescription: Revisión\nallowed-tools: shell_run\n---\nEjecuta scripts/check.py', false);
  mkdirSync(path.join(path.dirname(target), 'scripts'));
  writeFileSync(path.join(path.dirname(target), 'scripts/check.py'), "raise RuntimeError('No ejecutar')");
  const result = load();
  expect(result.contents.review).toContain('allowed-tools: shell_run');
  expect(result.opened).toEqual([target]);
});
