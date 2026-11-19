import { proxyActivities, condition, defineSignal, setHandler, continueAsNew } from '@temporalio/workflow';
import type { Activities } from './activities.ts';
const { advance, executeJob } = proxyActivities<Activities>({ startToCloseTimeout: '130 minutes', heartbeatTimeout: '20 seconds', retry: { initialInterval: '2 seconds', maximumInterval: '10 seconds', maximumAttempts: 8 } });
export async function delivery(input: {
    projectId: string;
    runId: string;
}) {
    let pending=false,cycles=0;
    setHandler(defineSignal('command'),()=>{pending=true;});
    while (true) {
        if(++cycles>100)await continueAsNew<typeof delivery>(input);
        const step = await advance(input);
        if (['succeeded', 'failed', 'canceled'].includes(step.status))
            return { status: step.status };
        if (step.jobs.length)
            await Promise.all(step.jobs.map(job => executeJob(job)));
        else {
            await condition(()=>pending,'30 seconds');
            pending=false;
        }
    }
}
