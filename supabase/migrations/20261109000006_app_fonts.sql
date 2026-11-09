-- Fuente del sistema (Bootzy TM) fuera del repo público: bucket de solo lectura para web y worker.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-fonts', 'app-fonts', true, 2097152, array['font/ttf','font/woff2','application/octet-stream','font/sfnt'])
on conflict (id) do nothing;
-- Sin políticas de escritura para clientes: solo se sube desde el panel/servicio.
