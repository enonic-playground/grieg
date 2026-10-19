import { ExternalLink, Trash2 } from 'lucide-react';

import type { CronJob, ToolResults } from '../shapes';
import type { ReactElement } from 'react';

import { Button } from '../../js/components/ui/button';
import { describeCron } from '../../js/lib/cron';
import { relativeTime, shortUser } from '../../js/lib/format';
import { useCard } from '../card-context';
import { Dot, Empty, EnabledPill, Meta, Mono, Row } from '../components';

function toggleRequest(job: CronJob, name: string): { request: string; hint: string } {
  const verb = job.enabled ? 'Disable' : 'Enable';
  if (job.workflowId != null) {
    return {
      request: `${verb} the schedule of the grieg workflow "${name}" (workflowId ${job.workflowId}).`,
      hint: `${verb.toLowerCase()} the schedule of "${name}"`,
    };
  }
  return {
    request: `${verb} the scheduled job "${job.name}" (another application's job, by name).`,
    hint: `${verb.toLowerCase()} the job "${job.name}"`,
  };
}

const CronRow = ({ job }: { job: CronJob }): ReactElement => {
  const { ask, host, locale } = useCard();
  const name = job.workflowName ?? job.name;
  const words = describeCron(job.cron);
  const toggle = toggleRequest(job, name);

  return (
    <Row
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => ask(toggle.request, toggle.hint)}>
            {job.enabled ? 'Disable' : 'Enable'}
          </Button>
          {job.workflowId != null && (
            <Button
              size="icon"
              variant="ghost"
              className="hover:text-danger"
              aria-label={`Delete the schedule of ${name}`}
              title="Delete schedule"
              onClick={() =>
                ask(
                  `Delete the schedule of the grieg workflow "${name}" (workflowId ${job.workflowId}). Keep the workflow and its runs.`,
                  `delete the schedule of "${name}"`,
                )
              }
            >
              <Trash2 />
            </Button>
          )}
          {job.adminUrl != null && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Open ${name} in the admin tool`}
              title="Open in admin"
              onClick={() => host.openLink(job.adminUrl as string)}
            >
              <ExternalLink />
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium" title={job.name}>
          {name}
        </span>
        <EnabledPill enabled={job.enabled} />
      </div>
      <Meta>
        <span>{words ?? (job.cron == null ? 'One-time' : 'Custom schedule')}</span>
        {job.cron != null && <Mono className="text-dimmed">{job.cron}</Mono>}
        {job.timeZone != null && <span>{job.timeZone}</span>}
      </Meta>
      <Meta>
        {job.user != null && <span title={job.user}>as {shortUser(job.user)}</span>}
        {job.user != null && <Dot />}
        <span title={job.lastRun ?? undefined}>
          {job.lastRun == null ? 'Never ran' : `Last ran ${relativeTime(job.lastRun, locale)}`}
        </span>
        {job.workflowId == null && (
          <>
            <Dot />
            <Mono className="truncate" title={job.descriptor}>
              {job.descriptor}
            </Mono>
          </>
        )}
      </Meta>
    </Row>
  );
};

export const CronsView = ({ data }: { data: ToolResults['cron_list'] }): ReactElement =>
  data.jobs.length === 0 ? (
    <Empty>No scheduled jobs on this server.</Empty>
  ) : (
    <ul>
      {data.jobs.map((job) => (
        <CronRow key={job.name} job={job} />
      ))}
    </ul>
  );
