// Web Push: reaching a person whose browser is closed. The keys that identify this server to the
// browsers' push services come from the environment, or are made once and kept in the database so
// subscriptions survive a restart.
import webpush from 'web-push';

export function createPush({ store, app, config, log, send }) {
  let keys = config.vapid?.publicKey && config.vapid?.privateKey ? { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey } : store.get('settings', 'vapid');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    store.write('settings', 'vapid', keys);
  }
  const subject = config.vapid?.subject || (config.publicUrl?.startsWith('https://') ? config.publicUrl : 'mailto:admin@example.com');
  const deliver = send ?? ((subscription, body) => webpush.sendNotification(subscription, body, { vapidDetails: { subject, ...keys }, TTL: 3600, urgency: 'high' }));

  return {
    publicKey: keys.publicKey,
    /** Tell every browser a person has allowed. Never throws: a nudge has already been stored. */
    async notify(email, payload) {
      const body = JSON.stringify(payload);
      await Promise.all(app.nudges.subscriptionsFor(email).map(async (row) => {
        try {
          await deliver({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
        } catch (error) {
          // 404/410: the browser forgot the subscription. Anything else is worth a log line.
          if (error?.statusCode === 404 || error?.statusCode === 410) app.nudges.forget(row.endpoint);
          else log.warn('push failed', { status: error?.statusCode, message: error?.message });
        }
      }));
    },
  };
}
