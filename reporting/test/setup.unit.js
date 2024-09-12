import chrome from 'sinon-chrome';

chrome.storage.session = chrome.storage.local;

globalThis.chrome = chrome;
