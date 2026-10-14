import type { Node } from '/lib/xp/node';

import { ADMIN_ONLY, ensureAdminFolder, getConnection, isAdminOnly, runInRepo } from './repo';

export const WORKFLOWS_PATH = '/workflows';

export type WorkflowStep = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

export type Workflow = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  steps: WorkflowStep[];
  modifiedAt: string;
};

export type WorkflowInput = {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  steps?: WorkflowStep[];
};

type WorkflowData = {
  displayName?: string;
  description?: string;
  enabled?: boolean;
  // XP collapses a single-element array on read, so one step comes back as a bare object.
  steps?: WorkflowStep[] | WorkflowStep;
  modifiedAt?: string;
};

function toArray(steps: WorkflowStep[] | WorkflowStep | undefined): WorkflowStep[] {
  if (steps == null) return [];
  return Array.isArray(steps) ? steps : [steps];
}

function toWorkflow(node: Node<WorkflowData>): Workflow {
  return {
    id: node._id,
    name: node._name,
    displayName: node.displayName ?? node._name,
    description: node.description,
    enabled: node.enabled ?? false,
    steps: toArray(node.steps),
    modifiedAt: node.modifiedAt ?? '',
  };
}

function ensureParent(): void {
  ensureAdminFolder('/', 'workflows');
}

// Installs created before the store had an ACL keep the lib-node default on every workflow,
// and `ensureAdminFolder` only resets the subtree when the folder itself differs.
export function initWorkflows(): void {
  runInRepo(() => {
    ensureParent();
    const connection = getConnection();
    const children = connection.query({
      count: -1,
      query: { like: { field: '_path', value: `${WORKFLOWS_PATH}/*` } },
    });
    if (children.hits.length === 0) return;
    const found = connection.get(children.hits.map((hit) => hit.id));
    const nodes = found == null ? [] : Array.isArray(found) ? found : [found];
    if (nodes.every((node) => isAdminOnly(node._permissions))) return;

    connection.applyPermissions({ key: WORKFLOWS_PATH, permissions: ADMIN_ONLY, scope: 'TREE' });
    log.info(`Restricted ${WORKFLOWS_PATH} to administrators`);
  });
}

export function list(): Workflow[] {
  return runInRepo(() => {
    ensureParent();
    const connection = getConnection();
    const result = connection.query({
      count: 1000,
      query: { term: { field: '_parentPath', value: WORKFLOWS_PATH } },
      sort: '_name ASC',
    });

    const ids = result.hits.map((hit) => hit.id);
    if (ids.length === 0) return [];

    const nodes = connection.get<WorkflowData>(ids);
    if (nodes == null) return [];
    return (Array.isArray(nodes) ? nodes : [nodes]).map(toWorkflow);
  });
}

export function getById(id: string): Workflow | undefined {
  return runInRepo(() => {
    const node = getConnection().get<WorkflowData>(id);
    return node == null ? undefined : toWorkflow(node);
  });
}

export function createWorkflow(input: WorkflowInput): Workflow {
  return runInRepo(() => {
    ensureParent();
    const node = getConnection().create<WorkflowData>({
      _name: input.name,
      _parentPath: WORKFLOWS_PATH,
      _inheritsPermissions: true,
      displayName: input.displayName ?? input.name,
      description: input.description,
      enabled: input.enabled ?? false,
      steps: input.steps ?? [],
      modifiedAt: new Date().toISOString(),
    });
    return toWorkflow(node);
  });
}

export function updateWorkflow(id: string, input: Partial<WorkflowInput>): Workflow | undefined {
  return runInRepo(() => {
    const connection = getConnection();
    if (!connection.exists(id)) return undefined;

    const node = connection.update<WorkflowData>({
      key: id,
      editor: (current) => ({
        ...current,
        displayName: input.displayName ?? current.displayName,
        description: input.description ?? current.description,
        enabled: input.enabled ?? current.enabled,
        steps: input.steps ?? current.steps,
        modifiedAt: new Date().toISOString(),
      }),
    });
    return toWorkflow(node);
  });
}

export function deleteWorkflow(id: string): boolean {
  return runInRepo(() => getConnection().delete(id).length > 0);
}
