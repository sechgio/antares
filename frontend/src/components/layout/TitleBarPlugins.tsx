import { Suspense, lazy, useEffect, useRef, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  setPluginOrder,
  usePluginEnabled,
  usePluginOrder,
  type TitleBarPluginId,
} from '../../plugins';

const RadioWidget = lazy(() => import('./radio/RadioWidget'));
const SpotifyWidget = lazy(() => import('./spotify/SpotifyWidget'));
const AudiusWidget = lazy(() => import('./audius/AudiusWidget'));
const JamendoWidget = lazy(() => import('./streaming/JamendoWidget'));
const ArchiveWidget = lazy(() => import('./streaming/ArchiveWidget'));

const WIDGETS: Record<TitleBarPluginId, LazyExoticComponent<ComponentType>> = {
  'radio-live': RadioWidget,
  spotify: SpotifyWidget,
  audius: AudiusWidget,
  jamendo: JamendoWidget,
  archive: ArchiveWidget,
};

const PLUGIN_NAMES: Record<TitleBarPluginId, string> = {
  'radio-live': 'Radio Live',
  spotify: 'Spotify',
  audius: 'Audius',
  jamendo: 'Jamendo',
  archive: 'Archive',
};

function SortablePlugin({ id, children }: { id: TitleBarPluginId; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging, isOver } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`titlebar-plugin-${id}`}
      data-dragging={isDragging || undefined}
      className={`flex h-full items-stretch outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] ${
        isDragging
          ? 'z-20 cursor-grabbing shadow-[0_4px_14px_rgba(0,0,0,0.45)]'
          : 'cursor-grab'
      } ${isOver && !isDragging ? 'shadow-[inset_0_0_0_1px_var(--accent-primary)]' : ''}`}
      style={{
        // Solo el chip arrastrado se mueve; los demás quedan fijos en su hueco.
        transform: isDragging ? `${CSS.Translate.toString(transform)} scale(1.03)` : undefined,
        transition: isDragging ? 'none' : 'transform 160ms ease',
        touchAction: 'none',
      }}
      aria-label={PLUGIN_NAMES[id]}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export default function TitleBarPlugins() {
  const order = usePluginOrder();
  const enabled = {
    'radio-live': usePluginEnabled('radio-live'),
    spotify: usePluginEnabled('spotify'),
    audius: usePluginEnabled('audius'),
    jamendo: usePluginEnabled('jamendo'),
    archive: usePluginEnabled('archive'),
  } satisfies Record<TitleBarPluginId, boolean>;
  const visible = order.filter((id) => enabled[id]);
  const rowRef = useRef<HTMLDivElement>(null);
  const rowBoundsRef = useRef<DOMRect | null>(null);

  // Si el componente se desmonta a mitad de un drag (p.ej. plugin desactivado),
  // el cursor grabbing no puede quedarse pegado al body.
  useEffect(() => () => document.body.classList.remove('cursor-grabbing'), []);

  const sensors = useSensors(
    // El umbral evita que un click normal arme el drag; una vez activo, dnd-kit
    // ya suprime el click residual que caería sobre los botones internos.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Delimita el gesto a la barra de título: Y bloqueado (no sale de la franja)
  // y X acotada de borde a borde de la ventana, para moverse libre por la barra.
  const restrictToRow: Modifier = ({ transform, draggingNodeRect }) => {
    const next = { ...transform, y: 0 };
    const bounds = rowBoundsRef.current;
    if (!bounds || !draggingNodeRect) return next;
    if (draggingNodeRect.left + next.x < bounds.left) {
      next.x = bounds.left - draggingNodeRect.left;
    } else if (draggingNodeRect.right + next.x > bounds.right) {
      next.x = bounds.right - draggingNodeRect.right;
    }
    return next;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.classList.remove('cursor-grabbing');
    if (!over || active.id === over.id) return;
    const from = visible.indexOf(active.id as TitleBarPluginId);
    const to = visible.indexOf(over.id as TitleBarPluginId);
    if (from < 0 || to < 0) return;
    // Intercambio: solo los dos chips implicados cambian de sitio.
    const queue = [...visible];
    [queue[from], queue[to]] = [queue[to], queue[from]];
    // Los desactivados conservan su hueco en el orden guardado.
    setPluginOrder(order.map((id) => (enabled[id] ? queue.shift()! : id)));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      modifiers={[restrictToRow]}
      onDragStart={() => {
        rowBoundsRef.current =
          rowRef.current?.closest('.app-titlebar')?.getBoundingClientRect() ?? null;
        document.body.classList.add('cursor-grabbing');
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        document.body.classList.remove('cursor-grabbing');
      }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Se levantó ${PLUGIN_NAMES[active.id as TitleBarPluginId]}. Usa las flechas para moverlo.`,
          onDragOver: ({ active, over }) =>
            over && active.id !== over.id
              ? `${PLUGIN_NAMES[active.id as TitleBarPluginId]} está sobre ${PLUGIN_NAMES[over.id as TitleBarPluginId]}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over && active.id !== over.id
              ? `${PLUGIN_NAMES[active.id as TitleBarPluginId]} intercambiado con ${PLUGIN_NAMES[over.id as TitleBarPluginId]}.`
              : `${PLUGIN_NAMES[active.id as TitleBarPluginId]} soltado en su posición original.`,
          onDragCancel: ({ active }) =>
            `Se canceló el arrastre de ${PLUGIN_NAMES[active.id as TitleBarPluginId]}.`,
        },
        screenReaderInstructions: {
          draggable:
            'Para reordenar el plugin, pulsa espacio o enter, usa las flechas izquierda y derecha, y vuelve a pulsar para soltar.',
        },
      }}
    >
      <SortableContext items={visible} strategy={horizontalListSortingStrategy}>
        <div ref={rowRef} className="flex h-full items-stretch">
          {visible.map((id) => {
            const Widget = WIDGETS[id];
            return (
              <SortablePlugin key={id} id={id}>
                <Suspense fallback={null}>
                  <Widget />
                </Suspense>
              </SortablePlugin>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
