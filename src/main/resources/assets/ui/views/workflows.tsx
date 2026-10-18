import { ExternalLink, Play } from 'lucide-react';

import type { ToolResults, WorkflowItem } from '../shapes';
import type { ReactElement } from 'react';

import { Button } from '../../js/components/ui/button';
import { useCard } from '../card-context';
import { Dot, Empty, EnabledPill, Meta, Row, RunStatusLabel } from '../components';
import { describeCron } from '../cron';
import { relativeTime } from '../format';

function scheduleText(schedule: NonNullable<WorkflowItem['schedule']>): string {
  const words = describeCron(schedule.cron) ?? schedule.cron ?? 'One-time';
  return schedule.timeZone == null ? words : `${words} (${schedule.timeZone})`;
}

const WorkflowRow = ({ workflow }: { workflow: WorkflowItem }): ReactElement => {
  const { open, ask, host, locale } = useCard();
  const { id, displayName, description, stepCount, schedule, lastRun } = workflow;

  return (
    <Row
      label={`Runs of ${displayName}`}
      onOpen={() => open('run_list', { workflowId: id }, displayName)}
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              ask(
                `Run the grieg workflow "${displayName}" now (workflowId ${id}).`,
                `run "${displayName}" now`,
              )
            }
          >
            <Play />
            Run now
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Open ${displayName} in the admin tool`}
            title="Open in admin"
            onClick={() => host.openLink(workflow.adminUrl)}
          >
            <ExternalLink />
          </Button>
        </>
      }
    >
      <p className="truncate font-medium">{displayName}</p>
      {description != null && (
        <p className="text-muted-foreground truncate text-xs">{description}</p>
      )}
      <Meta>
        <span>{stepCount === 1 ? '1 step' : `${stepCount} steps`}</span>
        <Dot />
        {schedule == null ? (
          <span>Not scheduled</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {scheduleText(schedule)}
            <EnabledPill enabled={schedule.enabled} />
          </span>
        )}
        <Dot />
        {lastRun == null ? (
          <span>Never run</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <RunStatusLabel status={lastRun.status} />
            <span title={lastRun.startedAt}>{relativeTime(lastRun.startedAt, locale)}</span>
          </span>
        )}
      </Meta>
    </Row>
  );
};

export const WorkflowsView = ({ data }: { data: ToolResults['workflow_list'] }): ReactElement =>
  data.workflows.length === 0 ? (
    <Empty>No workflows yet. Create one in the admin tool.</Empty>
  ) : (
    <ul>
      {data.workflows.map((workflow) => (
        <WorkflowRow key={workflow.id} workflow={workflow} />
      ))}
    </ul>
  );
