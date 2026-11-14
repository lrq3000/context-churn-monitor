import { parentPort, workerData } from 'node:worker_threads';
import { Store } from '../storage/store.js';
import { writeReport } from './html.js';
const { database, session, directory, format } = workerData;
const store = await Store.open(database, {}, true);
try {
    parentPort.postMessage(writeReport(store, session, directory, format));
}
finally {
    store.close();
}
