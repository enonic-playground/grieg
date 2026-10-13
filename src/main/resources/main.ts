import { initKeyStore } from './lib/keys';
import { initRepo } from './lib/repo';
import { joinValues, toTag } from './lib/text';

initRepo();
initKeyStore();

const tags = [toTag('name', app.name), toTag('version', app.version)];

log.info(`Grieg started: ${joinValues(tags)}`);
