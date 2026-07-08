-- Color personalizable por proyecto (diferenciación visual en sidebar)

ALTER TABLE public.proyectos
  ADD COLUMN IF NOT EXISTS color text;