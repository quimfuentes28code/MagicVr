# MagicVR · Mesa aumentada para aprender Magic

Web app para móvil: abres la app, eliges modo (tutorial, 1 contra 1 o Commander) y a través de la cámara ves tu mesa con un **tapete virtual** encima. Juegas con tus **cartas físicas**: cada vez que bajas una carta la escaneas (o la buscas por nombre) y aparece en el tapete con su animación. La app lleva las vidas, las fases del turno y resuelve los combates, y te explica en cada momento qué puedes hacer.

## Qué incluye esta primera versión

- **Menú** con Tutorial, 1 contra 1, Commander y Reglas básicas.
- **Mesa aumentada**: cámara trasera de fondo + tapete en perspectiva (inclinación y tamaño ajustables en ☰). Si no hay cámara, se ve un tapete virtual.
- **Registrar cartas**: escáner OCR del nombre (Tesseract.js), búsqueda por nombre en español o inglés (API de Scryfall) y atajos para las tierras básicas. Las imágenes salen de Scryfall (en español si existen).
- **Motor de reglas simplificado**: una tierra por turno, pago de maná por colores (gira tus tierras solo), mareo de invocación, fases, ataques/bloqueos, daño de combate con vuela, alcance, prisa, vigilancia, arrollar, toque mortal y vínculo vital. Si haces algo ilegal te explica por qué (y te deja hacerlo igualmente si lo necesitas).
- **Tutorial interactivo** de 17 pasos sobre una partida real contra un bot, con botones de "carta de ejemplo" por si no tienes cartas a mano.
- **Bots**: 4 mazos de práctica (verde, rojo, blanco y negro) que juegan tierras, lanzan criaturas, atacan y bloquean con cabeza. 1 contra bot o Commander contra 1–3 bots.
- **Commander**: 40 vidas, zona de mando, impuesto de comandante, daño de comandante (21) y veneno.
- **Online con amigos**: uno crea una sala, los demás se unen con un código de 5 letras (WebRTC con PeerJS, sin servidor propio). Se pueden rellenar asientos con bots. 2 jugadores en 1 contra 1, hasta 4 en Commander.
- Animaciones de entrada de cartas, partículas por color, muertes, daño, banners de turno y ataque. Funciona como PWA (se puede "instalar" en la pantalla de inicio).

## Probarlo

```bash
npm install
npm run dev      # https://<tu-ip>:5173 (HTTPS para que el móvil deje usar la cámara)
npm test         # tests del motor de reglas y de los bots
npm run build    # genera dist/
```

En el móvil, conectado a la misma wifi, abre la URL "Network" que muestra `npm run dev` y acepta el aviso del certificado.

### Publicarlo para tus amigos (GitHub Pages)

El workflow `.github/workflows/pages.yml` publica la app cada vez que se hace push a `main`. Hay que activarlo una vez en **Settings → Pages → Source: GitHub Actions**. La URL quedará como `https://<usuario>.github.io/MagicVr/`.

### Servidor de emparejamiento propio (opcional)

Por defecto las salas usan el servidor público de PeerJS. Para usar uno propio (`npx peerjs --port 9000`), compila con:

```bash
VITE_PEER_HOST=mi-servidor.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ npm run build
```

## Estructura

```
src/engine/   motor de reglas puro (game.js), IA de bots (bot.js), cartas y mazos (cards.js)
src/ui/       mesa (table.js), selector/escáner (picker.js), tutorial, textos didácticos
src/session.js  partida local / anfitrión / cliente
src/net.js      salas online con PeerJS
src/scryfall.js búsqueda de cartas con caché
src/scanner.js  OCR del nombre de la carta
```

## Limitaciones conocidas / siguientes pasos

- No es "AR" con detección de superficies: el tapete se superpone a la cámara y se ajusta a mano. Siguiente paso: WebXR (Android) o app nativa (ARKit/ARCore) para anclar el tapete a la mesa real.
- Las habilidades de las cartas no se automatizan: el efecto de hechizos y habilidades se aplica a mano (tocar la criatura → daño, +X/+X, destruir, vidas…). El combate sí es automático. *Dañar primero* se simplifica.
- El escáner lee el nombre; funciona mejor con buena luz y la carta cerca. Mejora futura: reconocimiento por imagen de la ilustración.
- Online: el anfitrión guarda la partida; si se cierra su app, la partida termina.

Proyecto de fans no oficial, sin relación con Wizards of the Coast. Imágenes y datos de cartas cortesía de [Scryfall](https://scryfall.com).
