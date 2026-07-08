export interface ProductoQuimico {
  producto: string;
  composicion: string;
  lote: string;
  fecha_vencimiento: string;
  unidad: string;
  concentracion: string;
  cantidad: string;
}

export interface ServicioEfectuar {
  desinfeccion: boolean;
  limpieza_ambientes: boolean;
  limpieza_pozos_septicos: boolean;
  limpieza_reservorios: boolean;
}

export interface TiposTratamiento {
  pulverizado: boolean;
  atomizado: boolean;
  thermonebulizado: boolean;
  nebulizado_ulv: boolean;
  otros: string;
}

export interface ObservacionesRecomendaciones {
  observacion_a: string;
  observacion_b: string;
  observacion_c: string;
  recomendacion_a: string;
  recomendacion_b: string;
  recomendacion_c: string;
}

export type SatisfaccionType = 'muy_satisfecho' | 'satisfecho' | 'regular' | 'insatisfecho' | '';

export interface FichaTecnica {
  id: string;
  os_numero: string;
  cliente: string;
  fecha: string;
  direccion: string;
  distrito: string;
  servicio: ServicioEfectuar;
  diagnostico_area: string;
  condicion_sanitaria: string;
  tratamiento: TiposTratamiento;
  productos: ProductoQuimico[];
  acciones_correctivas: string;
  areas_tratadas: string;
  personal_tecnico: string[];
  hora_inicio: string;
  hora_termino: string;
  numero_certificado: string;
  obs_rec: ObservacionesRecomendaciones;
  satisfaccion: SatisfaccionType;
  status: 'draft' | 'completed';
  last_modified: string;
}

export type FichaTecnicaListItem = Pick<
  FichaTecnica,
  'id' | 'os_numero' | 'cliente' | 'direccion' | 'distrito' | 'fecha' | 'status'
>;

const emptyProducto = (): ProductoQuimico => ({
  producto: '',
  composicion: '',
  lote: '',
  fecha_vencimiento: '',
  unidad: '',
  concentracion: '',
  cantidad: '',
});

export const createEmptyFicha = (): FichaTecnica => ({
  id: '',
  os_numero: '',
  cliente: '',
  fecha: '',
  direccion: '',
  distrito: '',
  servicio: {
    desinfeccion: false,
    limpieza_ambientes: false,
    limpieza_pozos_septicos: false,
    limpieza_reservorios: false,
  },
  diagnostico_area: '',
  condicion_sanitaria: '',
  tratamiento: {
    pulverizado: false,
    atomizado: false,
    thermonebulizado: false,
    nebulizado_ulv: false,
    otros: '',
  },
  productos: [emptyProducto(), emptyProducto(), emptyProducto(), emptyProducto()],
  acciones_correctivas: '',
  areas_tratadas: '',
  personal_tecnico: ['', '', '', '', '', ''],
  hora_inicio: '',
  hora_termino: '',
  numero_certificado: '',
  obs_rec: {
    observacion_a: '',
    observacion_b: '',
    observacion_c: '',
    recomendacion_a: '',
    recomendacion_b: '',
    recomendacion_c: '',
  },
  satisfaccion: '',
  status: 'draft',
  last_modified: '',
});

/** Demo placeholder matching backend `template_placeholder_ficha` — used for live plantilla preview. */
export function createTemplatePlaceholderFicha(): FichaTecnica {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...createEmptyFicha(),
    id: 'XXXXXXXX',
    os_numero: 'OS-0000-000000',
    cliente: 'NOMBRE DEL CLIENTE',
    direccion: 'DIRECCION DE LA OBRA',
    distrito: 'DISTRITO',
    fecha: today,
  };
}

/** Merge partial/incomplete payloads (drafts, list items) so nested fields never crash the form. */
export function normalizeFicha(ficha: Partial<FichaTecnica> | null | undefined): FichaTecnica {
  const base = createEmptyFicha();
  if (!ficha) return base;

  const productosSrc = Array.isArray(ficha.productos) ? ficha.productos : [];
  const productos = [...productosSrc];
  while (productos.length < 4) productos.push(emptyProducto());

  const personal = Array.isArray(ficha.personal_tecnico) ? [...ficha.personal_tecnico] : [];
  while (personal.length < 6) personal.push('');

  const status = ficha.status === 'completed' || ficha.status === 'draft' ? ficha.status : base.status;
  const satisfaccion =
    ficha.satisfaccion === 'muy_satisfecho' ||
    ficha.satisfaccion === 'satisfecho' ||
    ficha.satisfaccion === 'regular' ||
    ficha.satisfaccion === 'insatisfecho' ||
    ficha.satisfaccion === ''
      ? ficha.satisfaccion
      : base.satisfaccion;

  return {
    ...base,
    ...ficha,
    id: typeof ficha.id === 'string' ? ficha.id : base.id,
    status,
    satisfaccion,
    servicio: { ...base.servicio, ...(ficha.servicio ?? {}) },
    tratamiento: { ...base.tratamiento, ...(ficha.tratamiento ?? {}) },
    obs_rec: { ...base.obs_rec, ...(ficha.obs_rec ?? {}) },
    productos: productos.map((p) => ({
      ...emptyProducto(),
      ...(p ?? {}),
    })),
    personal_tecnico: personal.slice(0, 6),
  };
}

/** Preview helper: empty selection shows blank plantilla structure (sech-gio style). */
export function normalizeFichaForPreview(ficha: FichaTecnica | null | undefined): FichaTecnica {
  if (!ficha) return createEmptyFicha();
  return normalizeFicha(ficha);
}
