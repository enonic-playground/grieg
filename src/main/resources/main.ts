import { initKeyStore } from './lib/keys';
import { initRepo } from './lib/repo';
import { joinValues, toTag } from './lib/text';
import { initWorkflows } from './lib/workflows';

initRepo();
initKeyStore();
initWorkflows();

const tags = [toTag('name', app.name), toTag('version', app.version)];

log.info(`Grieg started: ${joinValues(tags)}`);
