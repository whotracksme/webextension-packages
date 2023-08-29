export default class SerializableSet extends Array {
  add(value) {
    if (!this.has(value)) {
      this.push(value);
    }
  }

  has(value) {
    return this.includes(value);
  }

  delete(value) {
    const index = this.indexOf(value);
    if (index !== -1) {
      this.splice(index, 1);
    }
  }

  get size() {
    return this.length;
  }

  clear() {
    this.splice(0, this.length);
  }
}
