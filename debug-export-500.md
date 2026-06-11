[OPEN] Debug Session: export-500

## Síntoma
- El endpoint de exportación devuelve `500`.
- En cliente aparece `Failed to load resource` sobre `export`.

## Hipótesis
1. `readDb()` falla o devuelve `null` en Render por ruta/permisos.
2. `db` no tiene la estructura esperada y el export rompe al construir `exportData`.
3. La serialización de `res.json(exportData)` falla por contenido inesperado.
4. La autenticación/autorización del admin está desviando el flujo y termina en error.
5. Hay una diferencia entre entorno local y Render en la ruta efectiva de datos/subidas.

## Plan
- Añadir instrumentación mínima en lectura de DB y en `/api/admin/export`.
- Reproducir petición y recoger evidencia.
- Confirmar hipótesis.
- Aplicar el fix mínimo.
- Verificar con logs pre-fix y post-fix.

## Evidencia
- Pre-fix con cabeceras admin: `200`, por lo que `/api/admin/export` funciona cuando recibe autenticación válida.
- Pre-fix sin cabeceras: `500` con `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` en `authAdmin`.
- Logs del debug server muestran que `readDb()` parsea bien y que el export llega a respuesta lista cuando la petición sí entra autenticada.

## Conclusión
- Hipótesis 1 rechazada: la lectura de DB no es la causa primaria del fallo observado.
- Hipótesis 2 rechazada: la estructura de `db` es válida en las reproducciones.
- Hipótesis 3 rechazada: la serialización del export no falla con datos válidos.
- Hipótesis 4 confirmada parcialmente: el problema está antes del handler de export, en `authAdmin`, cuando faltan cabeceras.
- Hipótesis 5 no necesaria para explicar el `500` reproducido desde la UI.

## Fix Aplicado
- `authAdmin` ahora responde `401` si faltan credenciales, en vez de lanzar excepción.
- `public/admin.html` exporta usando `fetch` con `x-username` y `x-access-code`, y descarga el blob devuelto.

## Verificación
- Post-fix sin cabeceras: `401`.
- Post-fix con credenciales admin: `200`.
