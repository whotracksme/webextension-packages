import logger from '../../logger';

export default class Subject {
  constructor() {
    this.listeners = new Set();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return {
      unsubscribe: () => {
        this.listeners.delete(callback);
      },
    };
  }

  pub(message) {
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (e) {
        logger.error('Subject failed to notify listener', e);
      }
    });
  }
}
