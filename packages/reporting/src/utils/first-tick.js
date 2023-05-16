let isFirstTick = true;

if (typeof window !== 'undefined') {
  window.addEventListener('message', function onMessage(message) {
    if (message === 'guardFirstTick' || !isFirstTick) {
      window.removeEventListener('message', onMessage);
      isFirstTick = false;
    }
  });

  window.postMessage('guardFirstTick');
}

Promise.resolve().then(() => {
  isFirstTick = false;
});

setTimeout(() => {
  isFirstTick = false;
}, 0);

export default function guardFirstTick() {
  if (isFirstTick) {
    return;
  }
  throw new Error('Called not in the first tick');
}

// used only to ensure the module is load
export function checkFistTick() {
  return isFirstTick;
}
