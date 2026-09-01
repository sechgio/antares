import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

type MascotState = 'idle' | 'walking' | 'reacting' | 'clicked';
type Position = { x: number; y: number };

const SPRITE_W = 192;
const SPRITE_H = 208;
const DRAG_THRESHOLD_PX = 5;

function clampPosition(x: number, y: number, scale: number) {
  const petWidth = SPRITE_W * scale;
  const petHeight = SPRITE_H * scale;
  return {
    x: Math.min(Math.max(x, 0), window.innerWidth - petWidth),
    y: Math.min(Math.max(y, 0), window.innerHeight - petHeight),
  };
}

function loadSavedPosition(scale: number) {
  const savedX = localStorage.getItem('petdex_pos_x');
  const savedY = localStorage.getItem('petdex_pos_y');
  if (savedX !== null && savedY !== null) {
    return clampPosition(Number(savedX), Number(savedY), scale);
  }
  return clampPosition(window.innerWidth - SPRITE_W * scale - 20, window.innerHeight - SPRITE_H * scale - 30, scale);
}

function savePosition(x: number, y: number) {
  localStorage.setItem('petdex_pos_x', String(Math.round(x)));
  localStorage.setItem('petdex_pos_y', String(Math.round(y)));
}

function applyPosition(element: HTMLDivElement | null, position: Position) {
  if (element) element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
}

export default function PetMascot() {
  const [config, setConfig] = useState({
    enabled: false,
    spritesheetUrl: '',
    scale: 1.0,
    opacity: 100,
    movement: 'walk' as 'static' | 'walk',
  });

  const [direction, setDirection] = useState<1 | -1>(-1);
  const [mascotState, setMascotState] = useState<MascotState>('idle');
  const [frameCol, setFrameCol] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const stateRef = useRef<MascotState>('idle');
  const dirRef = useRef<1 | -1>(-1);
  const idleTicksRef = useRef(0);
  const reactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const pointerSessionRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const pendingDragPosRef = useRef<{ x: number; y: number } | null>(null);
  const posRef = useRef<Position | null>(null);
  const configRef = useRef(config);
  const mascotRef = useRef<HTMLDivElement | null>(null);

  const readPosition = useCallback((): Position => {
    const current = posRef.current;
    if (current) return current;

    const initial = loadSavedPosition(1);
    posRef.current = initial;
    return initial;
  }, []);

  const writePosition = useCallback((next: Position) => {
    posRef.current = next;
    applyPosition(mascotRef.current, next);
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const resumeMovement = useCallback(() => {
    if (configRef.current.movement === 'walk') {
      stateRef.current = 'walking';
      setMascotState('walking');
      return;
    }
    stateRef.current = 'idle';
    setMascotState('idle');
  }, []);

  const loadConfig = useCallback(() => {
    const enabled = localStorage.getItem('petdex_enabled') === 'true';
    const spritesheetUrl = localStorage.getItem('petdex_pet_spritesheet') || 'https://assets.petdex.dev/pets/belayer-cat-7fa042c8b542/sprite.webp';
    const scale = Number(localStorage.getItem('petdex_scale')) || 1.0;
    const opacity = Number(localStorage.getItem('petdex_opacity')) || 100;
    const movement = (localStorage.getItem('petdex_movement') as 'static' | 'walk') || 'walk';

    setConfig({ enabled, spritesheetUrl, scale, opacity, movement });
    const currentPosition = readPosition();
    writePosition(clampPosition(currentPosition.x, currentPosition.y, scale));
  }, [readPosition, writePosition]);

  useEffect(() => {
    loadConfig();

    const handleConfigChange = () => {
      loadConfig();
    };

    window.addEventListener('petdex-config-changed', handleConfigChange);
    return () => window.removeEventListener('petdex-config-changed', handleConfigChange);
  }, [loadConfig]);

  useEffect(() => {
    const handleResize = () => {
      const currentPosition = readPosition();
      writePosition(clampPosition(currentPosition.x, currentPosition.y, config.scale));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [config.scale, readPosition, writePosition]);

  useLayoutEffect(() => {
    if (config.enabled) applyPosition(mascotRef.current, readPosition());
  }, [config.enabled, config.scale, readPosition]);

  useEffect(() => {
    if (!config.enabled) return;

    // Un solo bucle rAF: movimiento suave por delta-time (60fps), la lógica de
    // estado y el sprite siguen avanzando al ritmo del tick anterior (130ms).
    let rafId = 0;
    let lastTime = performance.now();
    let frameAccum = 0;
    const TICK_MS = 130;
    const walkSpeed = 4 / TICK_MS; // px/ms — misma velocidad que el tick anterior (~30.8 px/s)

    const tick = () => {
      setFrameCol((f) => (f + 1) % 8);

      const currentState = stateRef.current;
      const petWidth = SPRITE_W * config.scale;

      if (config.movement === 'static') {
        if (currentState !== 'reacting' && currentState !== 'clicked') {
          setMascotState('idle');
          stateRef.current = 'idle';
        }
        return;
      }

      if (currentState === 'reacting' || currentState === 'clicked') return;

      if (currentState === 'walking') {
        if (Math.random() < 0.02) {
          stateRef.current = 'idle';
          setMascotState('idle');
          idleTicksRef.current = Math.floor(Math.random() * 20) + 15;
        }
      } else if (currentState === 'idle') {
        idleTicksRef.current -= 1;
        if (idleTicksRef.current <= 0) {
          let nextDir: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
          const currentX = readPosition().x;
          if (currentX < 100) nextDir = 1;
          else if (currentX > window.innerWidth - petWidth - 100) nextDir = -1;

          dirRef.current = nextDir;
          setDirection(nextDir);
          stateRef.current = 'walking';
          setMascotState('walking');
        }
      }
    };

    const loop = (time: number) => {
      const dt = Math.min(Math.max(time - lastTime, 0), 100);
      lastTime = time;

      // Coalescing del drag: los pointermove solo guardan en el ref y aquí se
      // aplica una única posición por frame (latest-event-wins).
      if (pendingDragPosRef.current) {
        const next = pendingDragPosRef.current;
        pendingDragPosRef.current = null;
        writePosition(next);
      }

      if (!isDraggingRef.current) {
        frameAccum += dt;
        if (frameAccum >= TICK_MS) {
          frameAccum %= TICK_MS;
          tick();
        }

        if (stateRef.current === 'walking' && config.movement === 'walk') {
          const petWidth = SPRITE_W * config.scale;
          const currentDir = dirRef.current;
          const currentPosition = readPosition();
          let nextX = currentPosition.x + currentDir * walkSpeed * dt;

          if (currentDir === 1 && nextX >= window.innerWidth - petWidth) {
            dirRef.current = -1;
            setDirection(-1);
            nextX = window.innerWidth - petWidth;
          } else if (currentDir === -1 && nextX <= 0) {
            dirRef.current = 1;
            setDirection(1);
            nextX = 0;
          }

          writePosition({ ...currentPosition, x: nextX });
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [config.enabled, config.movement, config.scale, readPosition, writePosition]);

  const getRow = () => {
    if (mascotState === 'clicked') return 4;
    if (mascotState === 'reacting') return 3;
    if (mascotState === 'walking') return direction === 1 ? 1 : 2;
    return 0;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    didDragRef.current = false;
    pointerSessionRef.current = true;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    dragOffsetRef.current = {
      x: e.clientX - readPosition().x,
      y: e.clientY - readPosition().y,
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!pointerSessionRef.current) return;

      const dx = ev.clientX - pointerStartRef.current.x;
      const dy = ev.clientY - pointerStartRef.current.y;
      if (!isDraggingRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        setIsDragging(true);
        if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current);
        stateRef.current = 'idle';
        setMascotState('idle');
      }

      didDragRef.current = true;
      // El bucle rAF aplica una sola posición por frame (coalescing, latest-event-wins).
      pendingDragPosRef.current = clampPosition(
        ev.clientX - dragOffsetRef.current.x,
        ev.clientY - dragOffsetRef.current.y,
        configRef.current.scale,
      );
    };

    const endPointerSession = () => {
      if (!pointerSessionRef.current) return;

      pointerSessionRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endPointerSession);
      window.removeEventListener('pointercancel', endPointerSession);

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        // Aplica el último pointermove pendiente (puede no haberse pintado aún).
        const final = pendingDragPosRef.current ?? readPosition();
        pendingDragPosRef.current = null;
        writePosition(final);
        savePosition(final.x, final.y);
      }

      resumeMovement();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endPointerSession);
    window.addEventListener('pointercancel', endPointerSession);
  };

  const handleMouseEnter = () => {
    if (isDraggingRef.current || mascotState === 'clicked') return;
    if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current);

    setMascotState('reacting');
    stateRef.current = 'reacting';
    setFrameCol(0);

    reactionTimeoutRef.current = setTimeout(() => {
      if (stateRef.current === 'reacting') resumeMovement();
    }, 2000);
  };

  const handleClick = () => {
    if (didDragRef.current) return;
    if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current);

    setMascotState('clicked');
    stateRef.current = 'clicked';
    setFrameCol(0);

    reactionTimeoutRef.current = setTimeout(() => {
      if (stateRef.current === 'clicked') resumeMovement();
    }, 1500);
  };

  if (!config.enabled || !config.spritesheetUrl) return null;

  const w = SPRITE_W * config.scale;
  const h = SPRITE_H * config.scale;
  const activeRow = getRow();

  return (
    <WithHoverTooltip label="Arrastra para mover. Clic para saltar." placement="bottom">
      <div
        data-testid="pet-mascot-container"
        ref={mascotRef}
        className="z-[90]"
        onPointerDown={handlePointerDown}
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
        aria-label="Arrastra para mover. Clic para saltar."
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: `${w}px`,
          height: `${h}px`,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          overflow: 'hidden',
          opacity: config.opacity / 100,
          transition: isDragging || mascotState === 'walking' ? 'none' : 'transform 0.15s ease-out',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: `${SPRITE_W}px`,
            height: `${SPRITE_H}px`,
            backgroundImage: `url(${config.spritesheetUrl})`,
            backgroundPosition: `-${frameCol * SPRITE_W}px -${activeRow * SPRITE_H}px`,
            transform: `scale(${config.scale})`,
            transformOrigin: 'top left',
            imageRendering: 'pixelated',
            pointerEvents: 'none',
          }}
        />
      </div>
    </WithHoverTooltip>
  );
}
