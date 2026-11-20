// Cámara trasera del móvil como fondo de la mesa ("realidad aumentada").

let stream = null;
let starting = null;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function startCamera(video) {
  if (!cameraSupported()) throw new Error('Este navegador no permite usar la cámara (¿estás en HTTPS?).');
  if (!stream) {
    starting ||= navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    try {
      stream = await starting;
    } finally {
      starting = null;
    }
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function cameraActive() {
  return !!stream;
}

/** Captura un recorte del vídeo (coordenadas relativas 0..1 sobre lo que se ve en pantalla). */
export function grabFrame(video, rect) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw) return null;
  // El vídeo se muestra con object-fit: cover; calculamos qué parte es visible.
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const scale = Math.max(ew / vw, eh / vh);
  const visW = ew / scale;
  const visH = eh / scale;
  const offX = (vw - visW) / 2;
  const offY = (vh - visH) / 2;
  const sx = offX + rect.x * visW;
  const sy = offY + rect.y * visH;
  const sw = rect.w * visW;
  const sh = rect.h * visH;
  const canvas = document.createElement('canvas');
  const up = Math.max(1, 900 / sw);
  canvas.width = Math.round(sw * up);
  canvas.height = Math.round(sh * up);
  const ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
