import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard, AssistantTurn, MessageRow, PlanCard, ThinkingRow, groupTurns, placeArtifacts } from './AgentTimeline';

it('muestra el descubrimiento y la lectura de skills en la traza', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [
    { id: 'list', name: 'skills_list', params: {}, status: 'done', gated: false, result: '{"skills":[]}' },
    { id: 'read', name: 'skills_read', params: { skill_id: 'skill' }, status: 'done', gated: false,
      result: '{"name":"pdf-review","content":"Revisa las firmas"}' },
  ] }} />);
  expect(screen.getByText('Buscar skills disponibles')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Leer una skill'));
  expect(screen.getByText(/Revisa las firmas/)).toBeInTheDocument();
});

it('presenta el catálogo de skills con procedencia, límites y advertencias', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const result = JSON.stringify({ skills: [
    { id: 'local', name: 'pdf-review', description: 'Revisa firmas', location: 'C:\\skills\\pdf-review\\SKILL.md' },
    { id: 'attached', name: 'pdf-review', description: 'Revisa márgenes', location: 'C:\\proyecto\\pdf-review\\SKILL.md' },
  ], total: 4, truncated: true, library: 'C:\\skills', warnings: ['Una skill no tiene descripción'], notice: 'No concede permisos.' });
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'list', name: 'skills_list', params: {}, status: 'done', gated: false, result,
  }] }} />);
  fireEvent.click(screen.getByText('Buscar skills disponibles'));
  expect(screen.getByText('2 de 4 skills · catálogo parcial')).toBeVisible();
  expect(screen.getAllByText('pdf-review')).toHaveLength(2);
  expect(screen.getByText('Revisa firmas')).toBeVisible();
  expect(screen.getByText('C:\\proyecto\\pdf-review\\SKILL.md')).toBeVisible();
  expect(screen.getByText('Biblioteca local: C:\\skills')).toBeVisible();
  expect(screen.getByText('Una skill no tiene descripción')).toBeVisible();
  expect(screen.getByText('No concede permisos.')).toBeVisible();
  fireEvent.click(screen.getByText('Datos originales'));
  expect(screen.getByText(result)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar json' }));
  expect(writeText).toHaveBeenCalledWith(result);
});

it('distingue una lectura parcial de una completa y muestra el contenido sin ejecutar HTML', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const content = '<img src=x onerror=alert(1)>\nRevisa las firmas';
  const message = (nextOffset: number | null) => ({ role: 'assistant' as const, content: '', ts: 1, tool_calls: [{
    id: 'read', name: 'skills_read', params: { skill_id: 'skill' }, status: 'done' as const, gated: false,
    result: JSON.stringify({ name: 'pdf-review', file_path: 'references/firmas.md', content, offset: 4000,
      total_chars: 8000, next_offset: nextOffset, notice: 'Solo lectura.' }),
  }] });
  const { container, rerender } = render(<MessageRow msg={message(8000)} />);
  fireEvent.click(screen.getByText('Leer una skill'));
  expect(screen.getByText('pdf-review')).toBeVisible();
  expect(screen.getByText('references/firmas.md')).toBeVisible();
  expect(screen.getByText('Lectura parcial · siguiente offset: 8000')).toBeVisible();
  expect(screen.getByText('Solo lectura.')).toBeVisible();
  expect(screen.getByText(content, { normalizer: (text) => text })).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar contenido' }));
  expect(writeText).toHaveBeenCalledWith(content);
  rerender(<MessageRow msg={message(null)} />);
  expect(screen.queryByText(/siguiente offset/)).not.toBeInTheDocument();
  expect(screen.getByText('Fin del archivo · 8000 caracteres en total')).toBeVisible();
});

it('explica un catálogo vacío y conserva salidas antiguas, inválidas y errores', () => {
  const message = (result: string, status: 'done' | 'failed' = 'done') => ({ role: 'assistant' as const, content: '', ts: 1,
    tool_calls: [{ id: 'list', name: 'skills_list', params: {}, status, gated: false, result }] });
  const { rerender } = render(<MessageRow msg={message(JSON.stringify({
    skills: [], total: 0, truncated: false, library: 'C:\\skills', warnings: [], notice: 'Solo lectura.',
  }))} />);
  fireEvent.click(screen.getByText('Buscar skills disponibles'));
  expect(screen.getByText('No se encontraron skills en los recursos autorizados.')).toBeVisible();
  for (const result of ['{"skills":[null]}', '{"skills":[]}', 'Salida sin JSON', '{"error":"Permiso revocado"}']) {
    rerender(<MessageRow msg={message(result)} />);
    expect(screen.getByText(result.startsWith('{') ? JSON.stringify(JSON.parse(result), null, 2) : result,
      { normalizer: (text) => text })).toBeVisible();
    expect(screen.queryByText('Datos originales')).not.toBeInTheDocument();
  }
  rerender(<MessageRow msg={message('{"error":"Permiso revocado"}', 'failed')} />);
  expect(screen.getByText('Error')).toBeVisible();
  expect(screen.getByText(/Permiso revocado/)).toHaveClass('text-[var(--accent-red)]');
});

it('identifica la búsqueda de conversaciones en español y muestra su resultado', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'history', name: 'sessions_search', params: { query: 'Boreal' }, status: 'done', gated: false,
    result: JSON.stringify({ matches: [{ title: 'Proyecto Boreal', excerpt: 'Carta número 42' }] }),
  }] }} />);
  fireEvent.click(screen.getByText('Buscar en conversaciones anteriores'));
  expect(screen.getByText(/Carta número 42/)).toBeInTheDocument();
});

it('muestra cuenta y recursos revisados antes de una decisión explícita', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'approval', session_id: 'session', call_id: 'call', method: 'autoimg_sheets_write_range',
    params: { range: 'CONFIG!A1', values: [['dato']] }, status: 'pending', created_at: 1, decided_at: null,
    channel: 'cloud',
    context: { account: 'prueba@example.com', sheet_id: 'hoja-de-prueba' },
    resources: [{ path: 'C:\\trabajos\\informe.pdf', sha256: 'revision' }],
  }} />);
  expect(screen.getByText('Nube y conexiones')).toBeInTheDocument();
  expect(screen.getByText('Cuenta: prueba@example.com')).toBeInTheDocument();
  expect(screen.getByText('Hoja: hoja-de-prueba')).toBeInTheDocument();
  expect(screen.getByText('Rango: CONFIG!A1')).toBeInTheDocument();
  expect(screen.getByText('Archivo: C:\\trabajos\\informe.pdf')).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Permitir esta acción' }));
  expect(decide).toHaveBeenCalledWith('approval', true);
});


it('resume más de dos pasos de herramientas y los abre si alguno necesita atención', () => {
  const step = (id: string, status: string) => ({ id, name: 'templates_catalog', params: {}, status, gated: false });
  const { rerender } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1,
    tool_calls: [step('a', 'done'), step('b', 'done'), step('c', 'done')] } as never} />);
  expect(screen.getByRole('button', { name: '3 pasos' })).toHaveAttribute('aria-expanded', 'false');
  rerender(<MessageRow msg={{ role: 'assistant', content: '', ts: 1,
    tool_calls: [step('a', 'done'), step('b', 'failed'), step('c', 'done')] } as never} />);
  expect(screen.getByRole('button', { name: /3 pasos/ })).toHaveAttribute('aria-expanded', 'true');
});

it('conserva la apertura elegida por el usuario cuando terminan las herramientas', () => {
  const message = (status: 'running' | 'done' | 'failed') => ({ role: 'assistant' as const, content: '', ts: 1,
    tool_calls: ['a', 'b', 'c'].map((id) => ({ id, name: 'canvas_list', params: {}, status: id === 'c' ? status : 'done' as const, gated: false })) });
  const { rerender } = render(<MessageRow msg={message('running')} />);
  const summary = screen.getByRole('button', { expanded: true, name: 'Listar documentos de Canvas' });
  fireEvent.click(summary);
  fireEvent.click(summary);
  rerender(<MessageRow msg={message('done')} />);
  expect(screen.getByRole('button', { name: '3 pasos' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: '3 pasos' }));
  rerender(<MessageRow msg={message('failed')} />);
  expect(screen.getByRole('button', { name: /3 pasos/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('· 1 por revisar')).toBeVisible();
});

it('agrupa el trabajo de un turno en un solo bloque y deja la respuesta final fuera de él', () => {
  const call = (id: string) => ({ id, name: 'fs_read', params: { path: `${id}.txt` }, status: 'done' as const, gated: false });
  const messages = [
    { role: 'user' as const, content: 'Revisa', ts: 1_000 },
    { role: 'assistant' as const, content: 'Voy a leer los archivos.', ts: 2_000, tool_calls: [call('a'), call('b')] },
    { role: 'tool_result' as const, content: '', ts: 2_500 },
    { role: 'assistant' as const, content: '', ts: 3_000, tool_calls: [call('c')] },
    { role: 'assistant' as const, content: 'Todo correcto.', ts: 43_000 },
  ];
  const turns = groupTurns(messages);
  expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
  const turn = turns[1];
  if (turn.role !== 'assistant') throw new Error('turno inesperado');
  render(<AssistantTurn messages={turn.messages} startedAt={turn.startedAt} />);
  expect(screen.getAllByText('Agente')).toHaveLength(1);
  expect(screen.getByText('Todo correcto.')).toBeVisible();
  expect(screen.queryByText('Voy a leer los archivos.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Trabajó durante 42 s · 3 pasos' }));
  expect(screen.getByText('Voy a leer los archivos.')).toBeVisible();
  expect(screen.getByText('c.txt')).toBeVisible();
});

it('coloca cada resultado en el turno que lo produjo y no repite el mismo archivo', () => {
  const file = (sha256: string) => ({ name: 'Formato-D.pdf', sha256, pages: 1, mime: 'application/pdf', size: 2048 });
  const artifact = (id: string, sha256: string) => ({ id, family: 'formato', template_id: 'd', template_revision: 'r', files: [file(sha256)] });
  const turns = groupTurns([
    { role: 'user', content: 'Genera', ts: 1 },
    { role: 'assistant', content: '', ts: 2, tool_calls: [{ id: 'g', name: 'formatos_generate', params: {}, status: 'done', gated: false,
      result: JSON.stringify({ artifact: { id: 'first' } }) }] },
    { role: 'assistant', content: 'Hecho', ts: 3 },
    { role: 'user', content: 'Otra vez', ts: 4 },
    { role: 'assistant', content: 'Hecho', ts: 5 },
  ]);
  const placed = placeArtifacts(turns, [artifact('first', 'x'), artifact('dup-1', 'y'), artifact('dup-2', 'y'), artifact('empty', 'z')]
    .map((item) => (item.id === 'empty' ? { ...item, files: [] } : item)));
  expect(placed.get(1)?.map((item) => item.id)).toEqual(['first']);
  expect(placed.get(4)?.map((item) => item.id)).toEqual(['dup-2']);
  expect([...placed.values()].flat()).toHaveLength(2);
});

it('muestra la terminal con su carpeta y el código de salida en la cabecera', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'npm test', cwd: 'C:\\proyecto' }, status: 'failed', gated: true,
    result: JSON.stringify({ exit_code: 2, stdout: '', stderr: 'boom' }),
  }] }} />);
  expect(screen.getByText('C:\\proyecto')).toBeVisible();
  expect(screen.getByText('salida 2')).toBeVisible();
});

it('abre el error de una herramienta para poder revisarlo sin buscar sus detalles', () => {
  const { container } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'read', name: 'fs_read', params: { path: 'informe.pdf' }, status: 'failed', gated: false,
    result: '{"error":"El archivo ya no existe"}',
  }] }} />);
  expect(container.querySelector('details')?.open).toBe(true);
  expect(screen.getByText(/El archivo ya no existe/)).toBeVisible();
});

it('espera la aprobación del comando sin abrir una terminal vacía', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'shell', name: 'shell_run', params: { command: 'npm test' }, status: 'pending', gated: true,
  }] }} />);
  expect(screen.getByText('esperando aprobación')).toBeVisible();
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
});

it('conserva la posición de lectura del terminal y sigue la salida solo al volver al final', () => {
  const message = (output: string) => ({ role: 'assistant' as const, content: '', ts: 1, tool_calls: [{
    id: 'shell', name: 'shell_run', params: { command: 'npm test' }, status: 'running' as const, gated: true, output,
  }] });
  const { rerender } = render(<MessageRow msg={message('Primera línea')} />);
  const log = screen.getByRole('log');
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 100 });
  log.scrollTop = 120;
  fireEvent.scroll(log);
  rerender(<MessageRow msg={message('Primera línea\nSegunda línea')} />);
  expect(log.scrollTop).toBe(120);
  log.scrollTop = 900;
  fireEvent.scroll(log);
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1100 });
  rerender(<MessageRow msg={message('Primera línea\nSegunda línea\nTercera línea')} />);
  expect(log.scrollTop).toBe(1100);
});

it('muestra el comando completo antes de aprobarlo aunque supere los 400 caracteres', () => {
  const command = `Write-Output '${'a'.repeat(500)}'`;
  render(<ApprovalCard busy={false} onDecide={vi.fn()} approval={{
    id: 'a', session_id: 's', call_id: 'c', method: 'shell_run', status: 'pending', created_at: 1, decided_at: null,
    params: { command },
  }} />);
  expect(screen.getByText(command, { exact: true })).toBeVisible();
});

it('muestra los comandos como terminal: abierta y animada mientras corre, con su salida al terminar', () => {
  const shell = (status: string, result?: string) => ({ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'npm test' }, status, gated: true, result,
  }] }) as never;
  const { rerender } = render(<MessageRow msg={shell('running')} />);
  expect(screen.getByText(/Ejecutando/)).toBeVisible();
  expect(screen.getByRole('log', { name: 'Salida de npm test' })).toHaveAttribute('aria-busy', 'true');
  rerender(<MessageRow msg={shell('done', JSON.stringify({ exit_code: 1, stdout: 'ok 1\nfallo 2\n', stderr: '', duration_s: 4.2 }))} />);
  expect(screen.getByText(/Ejecutó/)).toBeVisible();
  expect(screen.getByRole('log', { name: 'Salida de npm test' })).toHaveAttribute('aria-busy', 'false');
  expect(screen.getByText('código 1')).toBeInTheDocument();
  expect(screen.getByText('fallo 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ejecutó npm test/ }));
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
});

it('cuenta los segundos de un comando en curso y deja la duración final al terminar', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const shell = (status: string, result?: string) => ({ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'npm test' }, status, gated: true, result,
    ...(status === 'running' ? { started_at: 7_000 } : {}),
  }] }) as never;
  const { rerender } = render(<MessageRow msg={shell('running')} />);
  expect(screen.getByLabelText('En curso desde hace 3 s')).toHaveTextContent('3 s');
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByLabelText('En curso desde hace 5 s')).toBeInTheDocument();
  rerender(<MessageRow msg={shell('done', JSON.stringify({ exit_code: 0, stdout: 'ok', duration_s: 5.4 }))} />);
  expect(screen.queryByLabelText(/En curso desde/)).not.toBeInTheDocument();
  expect(screen.getByText('5.4 s')).toBeInTheDocument();
  cleanup();
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'w', name: 'web_open', params: { url: 'https://example.com' }, status: 'running', gated: false, started_at: 8_000,
  }] } as never} />);
  expect(screen.getByLabelText('En curso desde hace 4 s')).toBeInTheDocument();
  vi.useRealTimers();
});

it('pinta en rojo las líneas de stderr y del error, no la salida normal', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'build' }, status: 'running', gated: true,
    result: JSON.stringify({ exit_code: 1, stdout: 'compilando\nlisto\n', stderr: 'aviso: obsoleto\n', error: 'falló' }),
  }] } as never} />);
  expect(screen.getByText('listo')).not.toHaveClass('text-[var(--accent-red)]');
  expect(screen.getByText('aviso: obsoleto')).toHaveClass('text-[var(--accent-red)]');
  expect(screen.getByText('falló')).toHaveClass('text-[var(--accent-red)]');
});

it('muestra la salida de un comando mientras se ejecuta', () => {
  const shell = (output: string) => ({ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'npm test' }, status: 'running', gated: true, result: null, output,
  }] }) as never;
  const { rerender } = render(<MessageRow msg={shell('compilando\n')} />);
  expect(screen.getByText('compilando')).toBeInTheDocument();
  rerender(<MessageRow msg={shell('compilando\n12 tests ok\n')} />);
  expect(screen.getByText('12 tests ok')).toBeInTheDocument();
  expect(screen.getByRole('log').querySelector('.agent-terminal-cursor')).not.toBeNull();
});

it('copia la salida de un comando terminado y la entrada de una herramienta', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const shell = (status: string) => ({ role: 'assistant', content: '', ts: 1, tool_calls: [
    { id: 't', name: 'shell_run', params: { command: 'dir' }, status, gated: true, result: JSON.stringify({ exit_code: 0, stdout: 'a.txt\nb.txt\n' }) },
  ] }) as never;
  const { rerender } = render(<MessageRow msg={shell('running')} />);
  expect(screen.queryByRole('button', { name: 'Copiar salida' })).not.toBeInTheDocument();
  rerender(<MessageRow msg={shell('done')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar salida' }));
  expect(writeText).toHaveBeenCalledWith('a.txt\nb.txt');
  cleanup();
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [
    { id: 'r', name: 'fs_read', params: { path: 'notas.txt' }, status: 'done', gated: false, result: '"hola"' },
  ] } as never} />);
  fireEvent.click(screen.getByText('notas.txt'));
  fireEvent.click(screen.getByRole('button', { name: 'Copiar entrada' }));
  expect(writeText).toHaveBeenLastCalledWith('{\n  "path": "notas.txt"\n}');
});

it('la salida de un comando se abre desplazada al final, como una terminal', () => {
  const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 't', name: 'shell_run', params: { command: 'npm test' }, status: 'running', gated: true,
    result: JSON.stringify({ stdout: Array.from({ length: 80 }, (_, i) => `línea ${i}`).join('\n') }),
  }] } as never} />);
  expect(screen.getByRole('log', { name: 'Salida de npm test' }).scrollTop).toBe(900);
  spy.mockRestore();
});

it('muestra cada herramienta con su argumento clave, entrada y salida, y marca errores y rechazos', () => {
  const call = (id: string, name: string, params: Record<string, unknown>, status: string, result?: string) => ({ id, name, params, status, gated: false, result });
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [
    call('a', 'fs_read', { path: 'C:\\datos\\ventas.csv' }, 'done', '{"total_lines":9}'),
    call('b', 'web_open', { url: 'https://es.wikipedia.org/wiki/Lima' }, 'failed', '{"error":"sin conexión"}'),
  ] } as never} />);
  expect(screen.getByText('C:\\datos\\ventas.csv')).toBeInTheDocument();
  fireEvent.click(screen.getByText('https://es.wikipedia.org/wiki/Lima'));
  expect(screen.getByText('Error')).toBeInTheDocument();
  expect(screen.getByText(/"error": "sin conexión"/)).toBeInTheDocument();
  expect(screen.getByText('fallida')).toBeInTheDocument();
  cleanup();
  const { container } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1,
    tool_calls: [call('c', 'fs_write', { path: 'informe.txt' }, 'denied')] } as never} />);
  expect(screen.getByText('rechazada')).toBeInTheDocument();
  expect(container.querySelector('details')).toBeNull();
});

it('muestra los saltos de línea reales en la salida de una herramienta y respeta las barras escapadas', () => {
  const { container } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'r', name: 'fs_read', params: { path: 'notas.txt' }, status: 'done', gated: false,
    result: JSON.stringify({ text: 'línea uno\nlínea dos', path: 'C:\\new\\notas.txt' }),
  }] } as never} />);
  const output = [...container.querySelectorAll('pre')].map((pre) => pre.textContent).find((text) => text?.includes('línea uno'));
  expect(output).toContain('línea uno\nlínea dos');
  expect(output).toContain('C:\\\\new\\\\notas.txt');
});

it('dibuja la delegación en otro agente como una traza con sus pasos', () => {
  render(<MessageRow agent={{ seed: 'antares', name: 'Antares' }} msg={{ role: 'assistant', content: 'Listo.', ts: 1,
    tool_calls: [{
      id: 'sub', name: 'subagent_run', params: { agent: 'Investigador', task: 'Busca documentos' }, status: 'done', gated: false,
      result: JSON.stringify({
        agent: { id: 'p1', name: 'Investigador' }, status: 'done', text: 'Encontré dos.', ms: 300,
        steps: [{ name: 'canvas_list', status: 'done' }],
      }),
    }] } as never} />);
  expect(screen.getByText('Investigador')).toBeInTheDocument();
  expect(screen.getByText('Listar documentos de Canvas')).toBeInTheDocument();
  expect(screen.getByText('Encontré dos.')).toBeInTheDocument();
  expect(screen.getByText('completado')).toBeInTheDocument();
});

it('anima al agente solo durante la respuesta y mantiene un estado textual de trabajo', () => {
  const agent = { seed: 'antares', name: 'Antares', color: '#0E7490' };
  const { rerender } = render(<MessageRow agent={agent} msg={{ role: 'assistant', content: 'Preparando', partial: true, ts: 1 }} />);
  expect(screen.getByRole('img', { name: 'Antares' })).toHaveAttribute('data-working', 'true');
  rerender(<MessageRow agent={agent} msg={{ role: 'assistant', content: 'Listo', ts: 1 }} />);
  expect(screen.getByRole('img', { name: 'Antares' })).toHaveAttribute('data-working', 'false');
  expect(screen.getByRole('img', { name: 'Antares' }).querySelector('path')).toHaveAttribute('stroke', agent.color);
  rerender(<ThinkingRow agent={agent} elapsedSeconds={61} />);
  expect(screen.getByRole('status')).toHaveTextContent('El agente está trabajando');
  expect(screen.getByRole('status')).toHaveTextContent('1m 1s');
  expect(screen.getByRole('img', { name: 'Antares' }).querySelector('path')).toHaveAttribute('stroke', agent.color);
});

it('muestra el razonamiento abierto mientras piensa y lo pliega al responder sin pisar la elección del usuario', () => {
  const reasoning = 'Comparo las dos plantillas';
  const { rerender } = render(<MessageRow msg={{ role: 'assistant', content: '', reasoning, partial: true, ts: 1 }} />);
  const toggle = screen.getByRole('button', { name: /Pensando/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).toBeNull();

  rerender(<MessageRow msg={{ role: 'assistant', content: 'Usa la B', reasoning, partial: true, ts: 1 }} />);
  expect(screen.getByRole('button', { name: /Pensó/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Pensó/ }));
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Usa la B', reasoning, ts: 1 }} />);
  expect(screen.getByRole('button', { name: /Pensó/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(reasoning).closest('[aria-hidden="true"]')).toBeNull();
});

it('no dibuja bloque de razonamiento cuando el modelo no lo expone', () => {
  render(<MessageRow msg={{ role: 'assistant', content: 'Listo', ts: 1 }} />);
  expect(screen.queryByRole('button', { name: /Pens/ })).toBeNull();
});

it('indica cuánto tardó en pensar', () => {
  const { rerender } = render(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', reasoning_ms: 12_400, ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó durante 12 s' })).toBeInTheDocument();
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', reasoning_ms: 75_000, ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó durante 1 min 15 s' })).toBeInTheDocument();
  rerender(<MessageRow msg={{ role: 'assistant', content: 'Listo', reasoning: 'Analizo', ts: 1 }} />);
  expect(screen.getByRole('button', { name: 'Pensó' })).toBeInTheDocument();
});

it('explica el archivo, destino y alcance de permitir o rechazar una acción', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'a1', session_id: 's', call_id: 'c', method: 'drafts_save',
    params: { name: 'borrador.pdf', destination_folder: 'C:\\Informes', filename: 'resumen.pdf' },
    status: 'pending', created_at: 1, decided_at: null,
  }} />);
  expect(screen.getByText('Guardar resumen.pdf')).toBeInTheDocument();
  expect(screen.getByText('Destino: C:\\Informes')).toBeInTheDocument();
  expect(screen.getByText('Nombre de salida: resumen.pdf')).toBeInTheDocument();
  expect(screen.getByText(/Permitir autoriza solo esta acción/)).toBeInTheDocument();
  expect(screen.getByText(/Rechazar la omite e informa al agente/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rechazar esta acción' }));
  expect(decide).toHaveBeenCalledExactlyOnceWith('a1', false);
});

it('ofrece permitir siempre en el dominio de una acción web y manda la elección', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'a2', session_id: 's', call_id: 'c', method: 'web_click',
    params: { ref: '1' }, status: 'pending', created_at: 1, decided_at: null,
    context: { page_url: 'https://tienda.miejemplo.pe/checkout', domain: 'tienda.miejemplo.pe', policy_blocked: false },
  }} />);
  expect(screen.getByText('Página actual: https://tienda.miejemplo.pe/checkout')).toBeInTheDocument();
  expect(screen.queryByText('Solo esta acción')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Permitir esta acción' }));
  expect(decide).toHaveBeenCalledWith('a2', true, { remember: false });
});

it('manda recordar cuando el usuario activa permitir siempre', () => {
  const decide = vi.fn();
  render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'a5', session_id: 's', call_id: 'c', method: 'web_type',
    params: { ref: '1', text: 'dato' }, status: 'pending', created_at: 1, decided_at: null,
    context: { page_url: 'https://tienda.miejemplo.pe/checkout', domain: 'tienda.miejemplo.pe', policy_blocked: false },
  }} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Permitir siempre en tienda.miejemplo.pe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Permitir esta acción' }));
  expect(decide).toHaveBeenCalledWith('a5', true, { remember: true });
});

it('no ofrece permitir siempre en un dominio bloqueado ni fuera del navegador', () => {
  const decide = vi.fn();
  const { rerender } = render(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'a3', session_id: 's', call_id: 'c', method: 'web_click',
    params: { ref: '1' }, status: 'pending', created_at: 1, decided_at: null,
    context: { page_url: 'https://www.bcp.pe/login', domain: 'www.bcp.pe', policy_blocked: true },
  }} />);
  expect(screen.getByText('Solo esta acción')).toBeInTheDocument();
  rerender(<ApprovalCard busy={false} onDecide={decide} approval={{
    id: 'a4', session_id: 's', call_id: 'c', method: 'shell_run',
    params: { command: 'dir' }, status: 'pending', created_at: 1, decided_at: null,
    context: { domain: 'miejemplo.pe', policy_blocked: false },
  }} />);
  expect(screen.getByText('Solo esta acción')).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
});

it.each(['metodo_desconocido', 'constructor'])('no inventa un efecto para %s ni decide al mostrarlo', (method) => {
  const decide = vi.fn();
  const approval = { id: 'a1', session_id: 's', call_id: 'c', method,
    params: { path: 'C:\\datos' }, status: 'pending', created_at: 1, decided_at: null } as const;
  const { rerender } = render(<ApprovalCard busy={false} onDecide={decide} approval={approval} />);
  expect(screen.getByText('Acción sin descripción disponible')).toBeInTheDocument();
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Ver detalles de la acción'));
  expect(screen.getByText(method, { selector: 'code' })).toBeVisible();
  rerender(<ApprovalCard busy onDecide={decide} approval={approval} />);
  expect(screen.getByRole('button', { name: 'Permitir esta acción' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Rechazar esta acción' })).toBeDisabled();
  expect(decide).not.toHaveBeenCalled();
});

it.each([
  { method: 'gdrive_upload', params: { replace_file_id: 'drive-informe', draft: 'nuevo.pdf' } },
  { method: 'onedrive_upload', params: { replace_item_id: 'onedrive-informe', draft: 'nuevo.pdf' } },
])('hace visible el reemplazo de un archivo en $method', ({ method, params }) => {
  render(<ApprovalCard busy={false} onDecide={vi.fn()} approval={{
    id: 'a', session_id: 's', call_id: 'c', method, params,
    status: 'pending', created_at: 1, decided_at: null, context: { account: 'ana@example.com' },
  }} />);
  expect(screen.getByText(/Archivo que se reemplaza: .*informe/)).toBeInTheDocument();
  expect(screen.getByText('Borrador: nuevo.pdf')).toBeInTheDocument();
  expect(screen.getByText('Cuenta: ana@example.com')).toBeInTheDocument();
});

it('muestra el plan con su progreso y la evidencia de cada paso', () => {
  render(<PlanCard running plan={{ goal: 'Preparar el informe', steps: [
    { title: 'Leer el Excel', status: 'done', evidence: 'fs_read devolvió 12 filas' },
    { title: 'Buscar el tipo de cambio', status: 'in_progress' },
    { title: 'Guardar el informe', status: 'pending' },
  ] }} />);
  expect(screen.getByRole('region', { name: 'Plan del agente' })).toBeInTheDocument();
  expect(screen.getByText('1 de 3 hechos')).toBeInTheDocument();
  expect(screen.getByText('fs_read devolvió 12 filas')).toBeInTheDocument();
  expect(screen.getByText('Buscar el tipo de cambio')).toHaveClass('agent-shimmer');
  fireEvent.click(screen.getByRole('button', { name: /Plan: Preparar el informe/ }));
  expect(screen.queryByText('Leer el Excel')).not.toBeInTheDocument();
});

it('detalla el comando y la ruta en la aprobación de una acción del equipo', () => {
  render(<ApprovalCard busy={false} onDecide={vi.fn()} approval={{
    id: 'a', session_id: 's', call_id: 'c', method: 'shell_run', status: 'pending', created_at: 1, decided_at: null,
    params: { command: 'Get-ChildItem', cwd: 'C:\datos' },
  }} />);
  expect(screen.getByText('Ejecutar un comando de PowerShell')).toBeInTheDocument();
  expect(screen.getByText('Get-ChildItem', { exact: true })).toBeVisible();
  expect(screen.getByText('Carpeta: C:\datos')).toBeInTheDocument();
  expect(screen.getByText(/puede acceder al equipo completo/)).toBeInTheDocument();
  expect(screen.getByText(/Requiere tu aprobación también en Acceso completo/)).toBeInTheDocument();
});

it('muestra la edición de un archivo como diff y lo marca aplicado al terminar', () => {
  const message = (status: 'running' | 'done') => ({ role: 'assistant' as const, content: '', ts: 1, tool_calls: [{
    id: 'e', name: 'fs_edit', gated: true, status,
    params: { path: 'C:\\proyecto\\src\\app.py', old: 'x = 1\ny = 2', new: 'x = 10\ny = 2' },
    result: status === 'done' ? '{"replacements":1}' : null,
  }] });
  const { rerender } = render(<MessageRow msg={message('running')} />);
  expect(screen.getByRole('button', { name: /Editando app\.py/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('1 líneas añadidas, 1 eliminadas')).toHaveTextContent('+1 −1');
  const diff = screen.getByRole('group', { name: 'Cambios del archivo' });
  expect(diff).toHaveTextContent('x = 10');
  expect(diff.querySelector('[data-kind="remove"]')).toHaveTextContent('x = 1');
  expect(diff).not.toHaveAttribute('data-applied');
  rerender(<MessageRow msg={message('done')} />);
  expect(screen.getByRole('button', { name: /Editó app\.py/ })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Cambios del archivo' })).toHaveAttribute('data-applied', 'true');
});

it('numera las líneas con el fragmento del resultado y despliega el contexto plegado', () => {
  const old = ['def total(xs):', ...Array.from({ length: 10 }, (_, i) => `    paso_${i}()`), '    return sum(xs)'].join('\n');
  const result = JSON.stringify({ replacements: 1, snippet: '1\tdef total(xs, tax):\n2\t    paso_0()\n3\t    paso_1()' });
  const { container } = render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'e', name: 'fs_edit', gated: true, status: 'done', result,
    params: { path: 'app.py', old, new: old.replace('def total(xs):', 'def total(xs, tax):').replace('sum(xs)', 'sum(xs) * tax') },
  }] }} />);
  const added = container.querySelectorAll('[data-kind="add"]');
  expect(added[0]).toHaveTextContent(/^1\+/);
  expect(added[0].querySelector('.agent-diff-word')).toHaveTextContent(', tax');
  expect(added[1]).toHaveTextContent(/^12\+/);
  expect(screen.queryByText('paso_5()')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '4 líneas sin cambios' }));
  expect(screen.getByText('paso_5()')).toBeInTheDocument();
});

it('pliega por defecto un archivo nuevo grande y enseña el error de una edición fallida', () => {
  const content = Array.from({ length: 40 }, (_, i) => `línea ${i}`).join('\n');
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [
    { id: 'w', name: 'fs_write', gated: true, status: 'done', params: { path: 'informe.md', content },
      result: '{"saved_path":"informe.md","replaced":false}' },
    { id: 'f', name: 'fs_edit', gated: true, status: 'failed', params: { path: 'a.txt', old: 'zzz', new: 'y' },
      result: '{"error":"No se encontró el fragmento"}' },
  ] }} />);
  const created = screen.getByRole('button', { name: /Creó informe\.md/ });
  expect(created).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(created);
  expect(screen.getAllByRole('group', { name: 'Cambios del archivo' })[0]).toHaveTextContent('línea 39');
  expect(screen.getByText('No se encontró el fragmento')).toBeVisible();
});

it('enseña el diff que se aplicará antes de aprobar una edición', () => {
  render(<ApprovalCard busy={false} onDecide={vi.fn()} approval={{
    id: 'a', session_id: 's', call_id: 'c', method: 'fs_edit', status: 'pending', created_at: 1, decided_at: null,
    params: { path: 'app.py', edits: [{ old: 'return 1', new: 'return 2' }] },
  }} />);
  expect(screen.getByText('Cambios que se aplicarán')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Cambios del archivo' })).toHaveTextContent('return 2');
});

it.each([false, true])('conserva la elección de mostrar los pasos al actualizar su estado: %s', (open) => {
  const message = (status: 'running' | 'done') => ({ role: 'assistant' as const, content: '', ts: 1,
    tool_calls: ['a', 'b', 'c'].map((id) => ({ id, name: 'fs_read', params: {}, gated: false, status })) });
  const { rerender } = render(<MessageRow msg={message(open ? 'done' : 'running')} />);
  const toggle = screen.getByRole('button', { expanded: !open });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', String(open));
  rerender(<MessageRow msg={message('done')} />);
  rerender(<MessageRow msg={message('running')} />);
  rerender(<MessageRow msg={message('done')} />);
  expect(toggle).toHaveAttribute('aria-expanded', String(open));
});


it('pregunta por la acción concreta y permite rechazarla o aprobarla', () => {
  const decide = vi.fn();
  const approval = { id: 'a1', session_id: 's', call_id: 'c', method: 'canvas_list', params: { destination_folder: 'C:\\salida', filename: 'a.pdf' }, status: 'pending', created_at: 1, decided_at: null } as const;
  const { rerender } = render(<ApprovalCard busy={false} onDecide={decide} approval={approval} />);
  expect(screen.getByRole('group', { name: 'Confirmación de acción' })).toHaveTextContent('Listar documentos de Canvas');
  expect(screen.getByText('Aprobación necesaria')).toBeVisible();
  expect(screen.getByText('Destino: C:\\salida')).toBeInTheDocument();
  expect(screen.getByText('Nombre de salida: a.pdf')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rechazar esta acción' }));
  expect(decide).toHaveBeenCalledWith('a1', false);
  rerender(<ApprovalCard busy onDecide={decide} approval={{ ...approval, method: 'metodo_desconocido' }} />);
  expect(screen.getByRole('group', { name: 'Confirmación de acción' })).toHaveTextContent('Acción sin descripción disponible');
  expect(screen.getByRole('button', { name: 'Permitir esta acción' })).toBeDisabled();
});
