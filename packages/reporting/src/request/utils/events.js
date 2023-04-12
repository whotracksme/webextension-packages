import DefaultMap from './default-map';

export class EventEmitter {
  constructor() {
    this.listeners = new DefaultMap(() => []);
  }

  clean_channel(event) {
    this.listeners.update(event, () => []);
  }

  pub(event, value) {
    this.listeners.get(event).forEach((listener) => {
      try {
        listener(value);
      } catch (e) {
        //
      }
    });
  }

  subscribe(event, listener) {
    this.listeners.update(event, (subscribers) => {
      return [...subscribers, listener];
    });
    return {
      unsubscribe: () => {
        this.listeners.update(event, (subscribers) => {
          return subscribers.filter((other) => other !== listener);
        });
      },
    };
  }
}

export default new EventEmitter();
