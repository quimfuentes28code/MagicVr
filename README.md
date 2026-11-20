# MagicVR · Mesa aumentada para aprender Magic

Web app para móvil: abres la app, eliges modo (tutorial, 1 contra 1 o Commander) y a través de la cámara ves tu mesa con un **tapete virtual** encima. Juegas con tus **cartas físicas**: cada vez que bajas una carta la escaneas (o la buscas por nombre) y aparece en el tapete con su animación. La app lleva las vidas, las fases del turno y resuelve los combates, y te explica en cada momento qué puedes hacer.

## Cómo se juega

1. Abre la app (APK de Android o la web instalada) y **gira el móvil en horizontal**: se pone en pantalla completa.
2. Elige modo: **Aprendiz** (tutorial), **Duelo** (1 contra 1) o **Commander**, contra golems (bots) o con amigos.
3. Apunta la cámara a tu mesa. A la derecha está el **círculo de invocación**: pon una carta dentro y la cámara **la lee sola** (sin pulsar nada). Aparece en el tablero holográfico con su animación. Si se equivoca, pulsa **Deshacer**.
4. El pergamino con el ojo te dice en cada momento qué puedes hacer. Toca cualquier carta del tablero para ver qué es y aplicarle efectos.

## Qué incluye

- **Aspecto de app/juego**: horizontal, pantalla completa, tema de fantasía (pergamino, oro, runas), menú con cartas de tarot, cajones de pergamino en vez de ventanas.
- **Cámara como interfaz**: reconocimiento continuo (OCR con Tesseract, incluido en la app, sin depender de internet) del nombre de la carta dentro del círculo; empareja con tolerancia a errores contra cartas conocidas (inglés o español) y, si no la conoce, la busca en Scryfall. No repite una carta mientras siga en el círculo.
- **Todas las cartas de Magic dentro de la app**: unas 35.000 cartas distintas (30.000+ con nombre, tipo y texto en español), generadas de los datos oficiales de Scryfall en `public/carddb.json` (~22 MB, se genera en cada compilación). La cámara reconoce cualquiera de ellas sin internet; las imágenes se descargan la primera vez y quedan guardadas. En **Grimorio → Todas las cartas** se puede buscar cualquier carta.
- **5 mazos con cartas oficiales para los golems** (300 cartas, 60 por mazo) descargadas de Scryfall con su imagen oficial en español, texto y datos: Furia del Bosque (verde), Horda Ardiente (rojo), Alas del Alba (blanco), Cripta Nocturna (negro) y Mareas Arcanas (azul). Se ven en **Grimorio → pestaña de cada mazo**. Los golems juegan con ellos.
- **Habilidades automáticas**: la app lee el texto oficial de cada carta y aplica sola daño («hace 3 de daño a cualquier objetivo»), destruir, +X/+X y −X/−X, devolver a la mano, robar, ganar/perder vidas, drenar, fichas de criatura, contadores +1/+1 y recuperar del cementerio. Si la carta pide un objetivo, te pide que toques la criatura o elijas el jugador. Lo que no reconoce se aplica a mano.
- **Grimorio**: búsqueda manual como plan B.
- **Motor de reglas simplificado**: una tierra por turno, maná por colores (gira tus tierras solo), mareo de invocación, fases, ataques/bloqueos, daño de combate con vuela, alcance, prisa, vigilancia, arrollar, toque mortal y vínculo vital. Si haces algo ilegal te explica por qué.
- **Tutorial** de 17 lecciones sobre una partida real.
- **Golems (bots)** con 4 mazos; **Commander** con zona de mando, impuesto y daño de comandante; **partidas online** con código de 5 letras (WebRTC/PeerJS).
- **APK de Android** (Capacitor): pantalla completa inmersiva, horizontal, pantalla siempre encendida.

## Probarlo

```bash
npm install
npm run dev      # https://<tu-ip>:5173 (HTTPS para que el móvil deje usar la cámara)
npm test         # tests del motor de reglas, bots y reconocimiento
npm run carddb   # descarga la base de datos de todas las cartas (necesario una vez)
npm run build    # genera dist/
```

En el móvil, conectado a la misma wifi, abre la URL "Network" que muestra `npm run dev` y acepta el aviso del certificado.

### APK de Android

Cada push compila un APK en GitHub Actions (workflow «APK de Android»). Descárgalo en la pestaña **Actions → última ejecución → Artifacts → MagicVR-apk**, pásalo al móvil e instálalo (hay que permitir «instalar apps de origen desconocido»).

Para compilarlo en tu ordenador (con Android Studio instalado): `npm run build && npx cap sync android && npx cap open android`.

### iPhone / iOS

El APK es solo para Android. En iPhone se usa la versión web instalada: abre la web en **Safari → Compartir → Añadir a pantalla de inicio**. Se abre a pantalla completa y con cámara, como una app. (Una app nativa de iOS necesita un Mac con Xcode y una cuenta de desarrollador de Apple.)

### Publicarlo como web (GitHub Pages)

El workflow `.github/workflows/pages.yml` publica la app cada vez que se hace push a `main`. Hay que activarlo una vez en **Settings → Pages → Source: GitHub Actions**. La URL quedará como `https://<usuario>.github.io/MagicVr/`.

### Servidor de emparejamiento propio (opcional)

Por defecto las salas usan el servidor público de PeerJS. Para usar uno propio (`npx peerjs --port 9000`), compila con:

```bash
VITE_PEER_HOST=mi-servidor.com VITE_PEER_PORT=443 VITE_PEER_PATH=/ npm run build
```

## Estructura

```
src/engine/   motor de reglas (game.js), habilidades (effects.js), IA de bots (bot.js), cartas y mazos (cards.js)
src/data/cards.json  cartas oficiales de los 5 mazos (se regenera con `NODE_USE_ENV_PROXY=1 node scripts/build-cards.mjs`)
src/ui/       mesa (table.js), selector/escáner (picker.js), tutorial, textos didácticos
src/session.js  partida local / anfitrión / cliente
src/net.js      salas online con PeerJS
src/scryfall.js búsqueda de cartas con caché
src/vision.js   reconocimiento continuo de cartas con la cámara (OCR)
src/native.js   pantalla completa, orientación, vibración
android/        proyecto Android (Capacitor)
```

## Limitaciones conocidas / siguientes pasos

- No es "AR" con detección de superficies: el tapete se superpone a la cámara y se ajusta a mano. Siguiente paso: WebXR (Android) o app nativa (ARKit/ARCore) para anclar el tapete a la mesa real.
- Se automatizan las habilidades más comunes (ver arriba); las más complejas (auras, habilidades activadas, contrahechizos…) se aplican a mano. *Dañar primero* se simplifica.
- El reconocimiento lee el nombre: necesita buena luz y que la carta ocupe bien el círculo. Mejora futura: reconocer por la ilustración.
- Online: el anfitrión guarda la partida; si se cierra su app, la partida termina.

Proyecto de fans no oficial, sin relación con Wizards of the Coast. Imágenes y datos de cartas cortesía de [Scryfall](https://scryfall.com).
