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
- **Grimorio**: búsqueda manual como plan B.
- **Motor de reglas simplificado**: una tierra por turno, maná por colores (gira tus tierras solo), mareo de invocación, fases, ataques/bloqueos, daño de combate con vuela, alcance, prisa, vigilancia, arrollar, toque mortal y vínculo vital. Si haces algo ilegal te explica por qué.
- **Tutorial** de 17 lecciones sobre una partida real.
- **Golems (bots)** con 4 mazos; **Commander** con zona de mando, impuesto y daño de comandante; **partidas online** con código de 5 letras (WebRTC/PeerJS).
- **APK de Android** (Capacitor): pantalla completa inmersiva, horizontal, pantalla siempre encendida.

## Probarlo

```bash
npm install
npm run dev      # https://<tu-ip>:5173 (HTTPS para que el móvil deje usar la cámara)
npm test         # tests del motor de reglas y de los bots
npm run build    # genera dist/
```

En el móvil, conectado a la misma wifi, abre la URL "Network" que muestra `npm run dev` y acepta el aviso del certificado.

### APK de Android

Cada push compila un APK en GitHub Actions (workflow «APK de Android»). Descárgalo en la pestaña **Actions → última ejecución → Artifacts → MagicVR-apk**, pásalo al móvil e instálalo (hay que permitir «instalar apps de origen desconocido»).

Para compilarlo en tu ordenador (con Android Studio instalado): `npm run build && npx cap sync android && npx cap open android`.

### Publicarlo como web (GitHub Pages)

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
src/vision.js   reconocimiento continuo de cartas con la cámara (OCR)
src/native.js   pantalla completa, orientación, vibración
android/        proyecto Android (Capacitor)
```

## Limitaciones conocidas / siguientes pasos

- No es "AR" con detección de superficies: el tapete se superpone a la cámara y se ajusta a mano. Siguiente paso: WebXR (Android) o app nativa (ARKit/ARCore) para anclar el tapete a la mesa real.
- Las habilidades de las cartas no se automatizan: el efecto de hechizos y habilidades se aplica a mano (tocar la criatura → daño, +X/+X, destruir, vidas…). El combate sí es automático. *Dañar primero* se simplifica.
- El reconocimiento lee el nombre: necesita buena luz y que la carta ocupe bien el círculo. Mejora futura: reconocer por la ilustración.
- Online: el anfitrión guarda la partida; si se cierra su app, la partida termina.

Proyecto de fans no oficial, sin relación con Wizards of the Coast. Imágenes y datos de cartas cortesía de [Scryfall](https://scryfall.com).
