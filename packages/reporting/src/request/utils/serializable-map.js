export default class SerializableMap extends Object {
  add(key, value) {
    this[key] = value;
  }

  set(key, value) {
    this.add(key, value);
  }

  get(key) {
    return this[key];
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this, key);
  }

  delete(key) {
    delete this[key];
  }

  size() {
    return Object.keys(this).length;
  }

  forEach(callback) {
    Object.entries(this).forEach(([key, value]) => callback(value, key));
  }
}
