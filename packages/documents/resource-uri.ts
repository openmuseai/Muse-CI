import {digest,fail} from '../../apps/api/store.ts';
import type {SmartDocRecord} from '../contracts/index.ts';

// A locator, never an access grant. Host resolves it against the signed-in
// account and the existing native resource source.
export function cloudResourceUri(doc:SmartDocRecord){
  if(!doc.cloud)fail('CLOUD_DOCUMENT_NOT_CONNECTED');const c=doc.cloud;
  const reference={protocol:'openmuse.resource-reference/v1',identity:{scope:c.subject,source:'appflowy-'+digest(c.origin).slice(0,24),workspace:c.workspaceId,mount:'pages',resource:c.viewId}};
  return 'openmuse-resource://v1/'+Buffer.from(JSON.stringify(reference)).toString('base64url');
}
