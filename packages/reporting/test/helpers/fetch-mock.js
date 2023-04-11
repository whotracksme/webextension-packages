// source https://stackoverflow.com/a/21797381
function base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export const createFetchMock =
  ({
    version = '2018-10-11',
    useDiff = false,
    local = true,
    cdn = true,
  } = {}) =>
  async (url) => {
    const fail = {
      ok: false,
    };
    if (url.includes('local') && !local) {
      return fail;
    }
    if (url.includes('cdn') && !cdn) {
      return fail;
    }
    return {
      ok: true,
      // for config
      async json() {
        return {
          version,
          useDiff,
        };
      },
      // for bloom filter
      async arrayBuffer() {
        if (url.includes('diff')) {
          return base64ToArrayBuffer('AAAAAgp4yhHUIy5ERA==');
        }
        return base64ToArrayBuffer('AAAAAgrdwUcnN1113w==');
      },
    };
  };
