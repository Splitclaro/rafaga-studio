# Ráfaga Studio — instrucciones para construir la beta con Claude Code

Preparado el 9 de noviembre de 2026. Nombre creativo propuesto: **Ráfaga Studio**. No se ha comprobado disponibilidad registral ni se ha comprado dominio.

## Qué recibes

- `CLAUDE.md`: punto de entrada autocontenido con el encargo principal íntegro, prioridades, comprobación de requisitos y revisión de referencias. Es el archivo que debes pedir a Claude que lea y ejecute.

- `PROMPT_MAESTRO_CLAUDE_CODE.md`: encargo completo ejecutable por Claude Code: producto, diseño, carpetas, arquitectura, datos, pipeline de IA, conexiones, despliegue y aceptación.
- `REVISION_REFERENCIAS_Y_DECISIONES.md`: observaciones de las referencias, alcance y fundamentos técnicos.
- `INICIO_PARA_PEGAR.txt`: mensaje directo para que Claude empiece a construir con el archivo maestro adjunto o accesible localmente.
- `COMPROBACION_DE_TUS_REQUISITOS.md`: revisión del encargo y pruebas exigidas para cada prioridad.

Versión reforzada: subtítulos como prioridad máxima; brief breve del usuario aplicado a la selección real; botones «Detectar momentos virales» y «Volver a detectar»; arranque directo de código y comprobación de proyectos de 30/60 min.

Este paquete contiene las instrucciones de desarrollo solicitadas. Todavía no es el código de la aplicación ni un despliegue de beta. La ejecución posterior requiere acceso a las cuentas correctas y a los servicios de IA/procesamiento.

## Cómo utilizarlo

1. Descomprime el paquete y abre su carpeta en Claude Code, en el equipo que tiene los vídeos de `/Users/studio/Downloads/`.
2. Escribe: **«Lee íntegramente CLAUDE.md y ejecuta el encargo. Empieza a construir la plataforma siguiendo sus prioridades y criterios de entrega»**. El archivo contiene todo el encargo; no hace falta pegar los demás documentos uno a uno.
3. Claude debe crear una carpeta NUEVA `rafaga-studio` dentro de `/Users/studio/Documents/Codex/`, crear allí `master/`, copiar los seis documentos íntegros, verificar sus hashes, crear un CLAUDE.md breve en la raíz que exija leer `master/CLAUDE.md`, comprobar las cuentas y crear recursos nuevos en GitHub/Vercel/Supabase. Tiene prohibido reutilizar el proyecto existente splitclaro.
4. Completa solo los logins/credenciales o autorizaciones de gasto que realmente falten. Los secretos van al entorno o gestores de secretos; nunca al repositorio público ni al chat.
5. Exige el informe de aceptación, la URL desplegada y la prueba real de subir → generar → editar → descargar con dos usuarios aislados. Una captura del dashboard no acredita una beta operativa.

Si Claude agota la sesión, continúa en la carpeta nueva con: «Lee CLAUDE.md, docs/STATUS.md y docs/IMPLEMENTATION_PLAN.md. Retoma la siguiente puerta de salida pendiente del encargo original. No reinicies ni crees proyectos nuevos si ya figuran en el manifiesto».

## Qué incluye la beta definida

Cuenta y workspace; subida reanudable; importación de URL directa autorizada; transcripción; brief editable que guía la selección; detección de momentos mediante botón visible; selección semántica; recorte/seguimiento; clips verticales; subtítulos animados editables; cinco presets; tres ratios; brand kit; versiones; export MP4/SRT/VTT/ZIP; automatización por feed de vídeo; modo en vivo HLS autorizado con selección continua; layout cámara + gameplay; cuotas; estados y recuperación de fallos; configuración y administración.

Publicación en redes y cobros son módulos condicionados a permisos/configuración externos. Exportar un clip para TikTok no equivale a publicar por su API. El prompt obliga a reconocer esta diferencia y prohíbe presentar conexiones simuladas como activas. El modo en vivo HLS autorizado sí forma parte del núcleo beta. Entrada RTMP propia, compatibilidad universal con directos de terceros, doblaje y editor multitrack quedan fuera de ese contrato.

## Accesos que probablemente necesitará Claude

| Servicio | Finalidad | Comprobación necesaria |
|---|---|---|
| GitHub | Repositorio público nuevo | Propietario splitclaro correcto y permiso de creación |
| Vercel | Web/API | Equipo correcto, proyecto nuevo, variables y callbacks |
| Supabase | Auth, Postgres, Storage y progreso | Organización correcta, región, RLS, cuotas y correo operativo |
| Runtime de jobs | FFmpeg/visión y tareas largas | Despliegue cloud real, scheduler, recursos y coste |
| ASR y LLM | Transcripción y selección | Claves privadas, modelos disponibles y límites |
| Correo transaccional | Verificación y recuperación | Remitente válido y envío de test autorizado |
| Redes sociales, si se activan | Publicación | App OAuth, permisos, cuentas compatibles y pruebas autorizadas |

No se presupone que disponer de Claude Code incluya crédito para APIs de IA, Storage o render. El prompt exige comprobar tarifas y permisos, y no autoriza contratar planes o activar cobros a usuarios sin aprobación concreta.
