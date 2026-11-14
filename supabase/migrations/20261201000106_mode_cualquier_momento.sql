-- Aditiva: añade el modo «cualquier_momento» a generations.mode (los valores existentes siguen siendo válidos).
alter table public.generations drop constraint if exists generations_mode_check;
alter table public.generations add constraint generations_mode_check check (mode is null or mode in
  ('cualquier_momento','automatico','por_tema','pregunta_respuesta','educativo','historia','destacados','manual'));
