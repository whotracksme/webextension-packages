import DefaultMap from './default-map';

const listeners = new DefaultMap(() => []);

export default {
  pub(event, value) {
    listeners.get(event).forEach((listener) => {
      try {
        listener(value);
      } catch (e) {
        //
      }
    });
  },

  subscribe(event, listener) {
    listeners.update(event, (subscribers) => {
      return [...subscribers, listener];
    });
    return {
      unsubscribe() {
        listener.update(event, (subscribers) => {
          return subscribers.filter((other) => other !== listener);
        });
      },
    };
  },
};
