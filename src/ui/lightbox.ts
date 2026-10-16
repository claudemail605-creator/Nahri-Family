/**
 * Fullscreen photo viewer — the details sheet's "view larger". One lightbox
 * at a time; closes on Escape (capture phase, so it wins over any dialog
 * behind it), on the close button and on a click outside the image.
 */

export interface LightboxOptions {
  src: string;
  alt: string;
  closeLabel: string;
}

let activeLightbox: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeLightbox();
}

export function closeLightbox(): void {
  window.removeEventListener('keydown', onKeydown, true);
  activeLightbox?.remove();
  activeLightbox = null;
}

export function openLightbox(options: LightboxOptions): void {
  closeLightbox();

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn lightbox__close';
  close.setAttribute('aria-label', options.closeLabel);
  close.textContent = '✕';

  const img = document.createElement('img');
  img.alt = options.alt;
  img.src = options.src;

  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', options.alt);
  box.append(close, img);
  box.addEventListener('click', (event) => {
    if (event.target === box || (event.target as Element).closest('.lightbox__close')) closeLightbox();
  });

  document.body.append(box);
  activeLightbox = box;
  window.addEventListener('keydown', onKeydown, true);
  close.focus();
}
