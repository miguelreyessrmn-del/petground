// =====================================================================
// PetGround — Service Worker
// Etapa 1-2: notificaciones locales mientras la app está abierta
// Etapa 3 (futura): recibir push en background — agregar listener 'push'
//                   sin cambiar ninguna otra parte de este archivo
// =====================================================================

const SW_VERSION = '1.0.0';

// ── Instalación y activación ─────────────────────────────────────────

self.addEventListener('install', event => {
  // Tomar control inmediatamente sin esperar al cierre de pestañas anteriores
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// ── Notificationclick: al tocar la notificación ──────────────────────
// Abre la app y navega al Centro de Operaciones
// Funciona tanto en Etapa 2 (local) como en Etapa 3 (push en background)

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const appUrl = 'https://miguelreyessrmn-del.github.io/petground/';
  const operacionId = event.notification.data?.id || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Si ya hay una ventana abierta, enfocarla y navegar
      for (const client of windowClients) {
        if (client.url.startsWith(appUrl)) {
          client.focus();
          // Enviar mensaje para navegar al Centro de Operaciones
          client.postMessage({
            type: 'NOTIF_CLICK',
            operacionId
          });
          return;
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      return clients.openWindow(appUrl);
    })
  );
});

// ── Notificationclose: el usuario descartó la notificación ───────────

self.addEventListener('notificationclose', event => {
  // Aquí se podría registrar un analytics event en el futuro
  console.log('[SW] Notificación descartada:', event.notification.tag);
});

// ── ETAPA 3 (FUTURA) — Push en background ────────────────────────────
// Descomenta esto cuando implementes VAPID + Edge Function:
//
// self.addEventListener('push', event => {
//   if (!event.data) return;
//   const data = event.data.json();
//   event.waitUntil(
//     self.registration.showNotification(data.titulo, {
//       body:    data.descripcion || '',
//       icon:    '/petground/icon-192.png',
//       badge:   '/petground/icon-72.png',
//       tag:     'op-' + data.id,
//       data:    { id: data.id },
//       vibrate: [200, 100, 200]
//     })
//   );
// });
