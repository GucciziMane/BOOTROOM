// Service worker minimal : reçoit les pushs (Web Push API) du chat et affiche une notification
// système, y compris quand aucun onglet du site n'est ouvert (tant que le navigateur tourne).
self.addEventListener("push", (event) => {
  let payload = { title: "Boot Room", body: "Nouveau message" };
  try {
    payload = event.data.json();
  } catch {
    // Payload absent/non-JSON : on garde le titre/texte par défaut plutôt que d'échouer.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      tag: "chat-message",
      data: { url: payload.url ?? "/chat" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/chat";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
