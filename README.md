# Suma · Finanzas personales

MVP local de finanzas personales. La aplicación completa está en **index.html**: no usa servicios externos, dependencias, instalación ni backend.

## Abrir

Haz doble clic en `index.html` o ábrelo con un navegador moderno (Chrome, Edge, Firefox o Safari). Mantén el mismo navegador, perfil y ubicación del archivo para conservar el acceso a los datos guardados.

## Uso

- **Inicio:** saldo total de todas las cuentas y movimientos registrados; ingresos, gastos y balance del mes seleccionado. Cambia el mes con el selector o las flechas. Las pestañas Resumen, Gastos e Ingresos comparten el mismo periodo.
- **Movimientos:** registra, edita y elimina ingresos y gastos. El historial permite ver todos los meses o filtrar por periodo y tipo. Los gastos heredan la clasificación de su categoría; el formulario solo muestra el color correspondiente, sin selección individual.
- **Categorías:** las 17 categorías de gasto y 3 de ingreso solicitadas, más categorías personalizadas. Despensa y Alimentación fuera de casa permanecen separadas. Al crear una categoría de gasto debes elegir Verde, Amarillo o Rojo. En la lista de categorías puedes cambiar su clasificación; todos sus gastos, de cualquier mes, reflejan el cambio automáticamente. Las categorías de ingreso no tienen clasificación.
- **Cuentas:** comienza con Efectivo y Banco en cero. Agrega cuentas con saldo inicial opcional. Cada saldo se calcula a partir del saldo inicial y todos sus movimientos.
- **Cargar datos de ejemplo:** botón discreto al pie de la navegación; en teléfono, icono de estrella de cuatro puntas en la cabecera. Solicita confirmación porque reemplaza los datos actuales. Carga 20 movimientos ficticios del mes actual y el anterior, con balances mensual positivo y negativo. Una banda identifica el conjunto como ejemplo.
- **Reiniciar datos:** botón al pie de la navegación; en teléfono, icono de flecha circular en la cabecera. Siempre requiere confirmar. Elimina movimientos y elementos personalizados y restaura las cuentas y categorías iniciales en cero. En modo de ejemplo también aparece **Eliminar ejemplo**.

## Decisiones y límites

- Todos los importes se almacenan y calculan como **centavos enteros**. Se admiten hasta dos decimales con punto o coma decimal, sin separadores de miles. Límite por monto o saldo inicial: $999,999,999.99 MXN en valor absoluto. Los movimientos deben ser mayores que cero; el saldo inicial admite valores negativos y vacío equivale a cero.
- El saldo actual considera **todos** los movimientos registrados, incluidos los de otros meses o fechas futuras. Los cuatro indicadores se muestran en las tres pestañas del dashboard; ingresos, gastos, listas y desgloses se filtran por el mes seleccionado.
- Los movimientos nuevos proponen la fecha de hoy. Si se registra uno de otro mes, se informa el periodo en el mensaje de guardado; se conserva el mes que se estaba consultando.
- La dona muestra una rebanada por categoría, ordenada de mayor a menor monto, con el mismo orden en la leyenda. Cada rebanada usa el verde, amarillo o rojo de su categoría. Las categorías que comparten color siguen separadas por límites blancos. El gris representa únicamente las categorías pendientes de clasificar.
- No se ofrece eliminar cuentas o categorías, de modo que no queden movimientos sin referencia. Sí se pueden editar y eliminar movimientos. Los nombres duplicados evidentes se rechazan ignorando mayúsculas, acentos y espacios repetidos; las categorías se comparan dentro de su tipo.
- `localStorage` conserva la información **solo en el navegador y perfil utilizados**. No hay sincronización ni copias de seguridad. Si se borran los datos del navegador, se pierde este registro. El almacenamiento de archivos locales depende del navegador; si está bloqueado o lleno, se muestra un error y no se aplica el cambio que no pudo guardarse.
- Si los datos guardados no se pueden leer o son inválidos, no se sobrescriben automáticamente. Se permite comenzar de nuevo mediante el reinicio confirmado.
- Los datos de ejemplo se reemplazan como conjunto; los cambios que hagas en ese conjunto también se borran al reiniciarlo, previa confirmación.
- Las categorías iniciales y las del ejemplo comienzan **Sin clasificar**. Se pueden registrar gastos mientras se configuran. El sistema no asigna colores según nombres ni interpreta su significado.

## Migración de la primera versión

El formato interno ahora usa `version: 2`, manteniendo la clave de almacenamiento `suma.finanzas.v1` para encontrar los registros existentes. Al leer la primera versión, se validan sus datos y se conserva una copia exacta en `suma.finanzas.backup-v1` antes de guardar el nuevo formato. Esta copia no se sobrescribe durante lecturas posteriores y se elimina al confirmar el reinicio de todos los datos.

Se conservan cuentas, saldos iniciales, categorías personalizadas, IDs, fechas, montos, descripciones y relaciones. Se elimina la clasificación individual de los movimientos en el formato activo. Las categorías de gasto migradas quedan **Sin clasificar**, incluso si sus antiguos movimientos tenían colores iguales: el usuario decide su clasificación, sin inferencias automáticas ni conflictos entre colores históricos. La copia del formato anterior conserva esas selecciones antiguas.

Si falta espacio o no se permite guardar, se mantienen los datos originales y se informa del fallo. Los registros migrados siguen disponibles en memoria; el guardado se vuelve a intentar con la siguiente modificación. La validación de importes y los cálculos financieros siguen usando centavos enteros sin cambios.

No se incluyen cuentas de usuario, nube, crédito, deudas, presupuestos, inversiones como activos, recomendaciones, IA ni conexiones bancarias. “Deudas” e “Inversiones” existen únicamente como categorías solicitadas.

## Validación automatizada opcional

La aplicación no necesita Node.js. Si está instalado, puedes repetir las pruebas de lógica y almacenamiento con:

```powershell
node --test tests/validar.cjs
```

Las pruebas ejecutan el JavaScript real extraído de `index.html`, sin paquetes externos, y cubren los escenarios A–G: saldo de $13,000, distribución por categoría, categoría personalizada y recarga, cuenta adicional y centavos, periodos, persistencia y reinicio confirmado. También verifican validación de fechas e importes, edición/eliminación, referencias e IDs, datos de ejemplo, escape de HTML y fallos de almacenamiento. El almacenamiento de las pruebas es aislado y no modifica los datos del navegador.

Resultado de la segunda iteración: **27 pruebas aprobadas**. Se ejecutaron las 15 pruebas anteriores antes de modificar el código, se adaptaron las relacionadas con la clasificación y se agregaron 12 pruebas. Estas cubren los seis escenarios nuevos: herencia de color, reclasificación retroactiva y persistencia, orden y colores de la dona y leyenda, gastos sin clasificar, categorías con el mismo color, estados vacío y de una sola categoría y regresión de operaciones y saldos. También cubren migración íntegra, copia anterior, migración repetida, fallos al guardar o respaldar y eliminación de la copia al reiniciar.

En el navegador se verificaron la clasificación obligatoria al crear categorías de gasto, dos gastos de Mascotas heredando Amarillo, su cambio retroactivo a Rojo después de recargar, edición y eliminación de movimientos y el escenario de $6,000 Rojo, $4,000 Verde, $2,000 Amarillo y $1,000 Rojo en ese orden. La primera iteración también validó el saldo de $13,000, meses vacíos, balance negativo del ejemplo, desglose de ingresos y reinicio confirmado seguido de recarga.

Se revisaron anchos de 1440, 1024, 768, 390 y 320 píxeles. Las cuatro secciones se verificaron a 320 píxeles sin desbordamiento horizontal; también se verificó el formulario de movimiento a ese ancho. La revisión visual utilizó un servidor HTTP local temporal porque el navegador integrado de pruebas bloquea el protocolo `file://`. La apertura directa por doble clic no pudo automatizarse en ese entorno; el archivo entregado no requiere servidor.
