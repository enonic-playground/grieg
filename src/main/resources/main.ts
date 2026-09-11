import { initRepo } from './lib/repo';
import { joinValues, toTag } from './lib/text';

initRepo();

const tags = [toTag('name', app.name), toTag('version', app.version)];

log.info(`Grieg started: ${joinValues(tags)}`);
