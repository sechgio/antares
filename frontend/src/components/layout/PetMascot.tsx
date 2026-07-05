import { useState, useEffect, useRef, useCallback } from 'react';

type MascotState = 'idle' | 'walking' | 'reacting' | 'clicked';

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

export default function PetMascot() {
  const [config, setConfig] = useState({
    enabled: false,
    spritesheetUrl: '',
    scale: 1.0,
    opacity: 100,
    movement: 'walk' as 'static' | 'walk',
  });

  const [pos, setPos] = useState(() => loadSavedPosition(1));
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
  const posRef = useRef(pos);
  const configRef = useRef(config);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

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
    setPos((prev) => clampPosition(prev.x, prev.y, scale));
  }, []);

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
      setPos((prev) => clampPosition(prev.x, prev.y, config.scale));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [config.scale]);

  useEffect(() => {
    if (!config.enabled) return;

    const interval = setInterval(() => {
      if (isDraggingRef.current) return;

      setFrameCol((f) => (f + 1) % 8);

      const currentState = stateRef.current;
      const currentDir = dirRef.current;
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
        setPos((prev) => {
          const speed = 4;
          let nextX = prev.x + currentDir * speed;

          if (currentDir === 1 && nextX >= window.innerWidth - petWidth) {
            dirRef.current = -1;
            setDirection(-1);
            nextX = window.innerWidth - petWidth;
          } else if (currentDir === -1 && nextX <= 0) {
            dirRef.current = 1;
            setDirection(1);
            nextX = 0;
          }

          if (Math.random() < 0.02) {
            stateRef.current = 'idle';
            setMascotState('idle');
            idleTicksRef.current = Math.floor(Math.random() * 20) + 15;
          }

          return { ...prev, x: nextX };
        });
      } else if (currentState === 'idle') {
        idleTicksRef.current -= 1;
        if (idleTicksRef.current <= 0) {
          let nextDir: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
          const currentX = posRef.current.x;
          if (currentX < 100) nextDir = 1;
          else if (currentX > window.innerWidth - petWidth - 100) nextDir = -1;

          dirRef.current = nextDir;
          setDirection(nextDir);
          stateRef.current = 'walking';
          setMascotState('walking');
        }
      }
    }, 130);

    return () => clearInterval(interval);
  }, [config.enabled, config.movement, config.scale]);

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
      x: e.clientX - posRef.current.x,
      y: e.clientY - posRef.current.y,
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
      const next = clampPosition(
        ev.clientX - dragOffsetRef.current.x,
        ev.clientY - dragOffsetRef.current.y,
        configRef.current.scale,
      );
      setPos(next);
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
        savePosition(posRef.current.x, posRef.current.y);
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
    <div
      data-testid="pet-mascot-container"
      className="z-[90]"
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
      onClick={handleClick}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        overflow: 'hidden',
        opacity: config.opacity / 100,
        transition: isDragging || mascotState === 'walking' ? 'none' : 'left 0.15s ease-out, top 0.15s ease-out',
        userSelect: 'none',
      }}
      title="Arrastra para mover. Clic para saltar."
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
  );
}